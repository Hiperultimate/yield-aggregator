import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { YieldAggregator } from "../target/types/yield_aggregator";
import JupLendIDL from "../idls/jup_lend.json";
import { JupLendIDLType } from "./jupLend";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getMint,
  getAssociatedTokenAddressSync,
  getAccount,
  Mint,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Connection,
} from "@solana/web3.js";
import { airdropTo, confirmTx, setUSDCViaCheatcode, convertJupFTokenToUsdcAmount, convertKaminoTokenToUsdcAmount, getThresholdAmount } from "../client_utility/helper-fns";
import { assert, expect } from "chai";
import { getDepositReserveLiquidityAccounts, initRpc } from "../client_utility/generate-kamino-accounts";
import { DEFAULT_RECENT_SLOT_DURATION_MS, KaminoMarket } from "@kamino-finance/klend-sdk";
import { Address } from "@solana/kit";
import { jupDeposit } from "../client_utility/instructionCalls/jupDeposit";
import { kaminoDeposit } from "../client_utility/instructionCalls/kaminoDeposit";

const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Mainnet
const JUP_LEND_ADDRESS = "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"; // Mainnet
const KLEND_PROGRAM_ID = new anchor.web3.PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD") as any;


describe("Rebalacing tests", () => {
  // Configure the client to use the local cluster.
  const connection = new Connection(
    "http://localhost:8899",
    "confirmed"
  );
  const provider = new anchor.AnchorProvider(
    connection,
    anchor.Wallet.local(),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.yieldAggregator as Program<YieldAggregator>;
  const jupLendProgram = new Program<JupLendIDLType>(
    JupLendIDL as JupLendIDLType,
    provider
  );

  // console.log("Checking jup lend accounts : ", jupLendProgram.account);

  let admin: anchor.web3.Keypair;
  let usdcMint: anchor.web3.PublicKey;
  let usdcMintDetails: Mint;
  let jupFTokenMint: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let allocationConfigPda: anchor.web3.PublicKey;
  let vaultUsdcAta: anchor.web3.PublicKey;
  let vaultFTokenAta: anchor.web3.PublicKey;
  let kaminoCollateralMint: anchor.web3.PublicKey;
  let vaultKaminoTokenAta: anchor.web3.PublicKey;
  let user: anchor.web3.Keypair;
  let userUsdcAta: anchor.web3.PublicKey;
  let userPositionPda: anchor.web3.PublicKey;

  before(async () => {
    admin = anchor.web3.Keypair.generate();
    const airdropAdminTx = await airdropTo(
      admin.publicKey,
      1000,
      provider.connection
    );
    await confirmTx(airdropAdminTx, provider.connection);

    usdcMintDetails = await getMint(
      provider.connection,
      new anchor.web3.PublicKey(USDC_MINT_ADDRESS)
    );
    usdcMint = usdcMintDetails.address;
    console.log("USDC Supply : ", usdcMintDetails.supply);

    const { getDepositContext } = await import("@jup-ag/lend/earn");

    const depositContext = await getDepositContext({
      asset: usdcMint, // asset mint address
      signer: admin.publicKey, // signer public key
      connection,
    });
    jupFTokenMint = depositContext.fTokenMint; // Static : 9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D
    const jupFTokenDetails = await getMint(
      connection,
      jupFTokenMint,
      "confirmed"
    );
    console.log("jupFToken supply :", jupFTokenDetails.supply);

    // Get Kamino collateral mint
    const kaminoMainMarket = new anchor.web3.PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
    const rpc = initRpc('http://localhost:8899');
    const market = await KaminoMarket.load(rpc as any, kaminoMainMarket.toBase58() as Address, DEFAULT_RECENT_SLOT_DURATION_MS);
    const reserve = market.getReserveByMint(usdcMint.toBase58() as Address);
    const ixAccounts = await getDepositReserveLiquidityAccounts(admin.publicKey, reserve.address, kaminoMainMarket.toBase58() as Address, usdcMint.toBase58() as Address);
    kaminoCollateralMint = ixAccounts.reserveCollateralMint;

    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), admin.publicKey.toBuffer()],
      program.programId
    );

    vaultUsdcAta = await getAssociatedTokenAddress(
      usdcMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    vaultFTokenAta = await getAssociatedTokenAddress(
      jupFTokenMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    vaultKaminoTokenAta = await getAssociatedTokenAddress(
      kaminoCollateralMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );

    // Setup user
    user = anchor.web3.Keypair.generate();
    const airdropUserTx = await airdropTo(
      user.publicKey,
      100,
      provider.connection
    );
    await confirmTx(airdropUserTx, provider.connection);

    // Create user's USDC ATA
    userUsdcAta = await getAssociatedTokenAddress(
      usdcMint,
      user.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const createUserAtaIx = createAssociatedTokenAccountInstruction(
      admin.publicKey,
      userUsdcAta,
      user.publicKey,
      usdcMint,
      TOKEN_PROGRAM_ID,
      anchor.utils.token.ASSOCIATED_PROGRAM_ID
    );
    const createAtaTx = new anchor.web3.Transaction().add(createUserAtaIx);
    await provider.sendAndConfirm(createAtaTx, [admin]);

    // Mint 1000 USDC (1_000_000_000 units) to user
    const userUSDTAmount = 1000;
    await setUSDCViaCheatcode(
      user.publicKey.toBase58(),
      userUSDTAmount,
      usdcMintDetails
    );
    const userUSDTAta = getAssociatedTokenAddressSync(
      usdcMint,
      user.publicKey,
      false
    );
    const userUSDTAtaDetails = await getAccount(
      provider.connection,
      userUSDTAta,
      "confirmed"
    );

    [userPositionPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_position"), user.publicKey.toBuffer()],
      program.programId
    );

    expect(userUSDTAtaDetails.amount).eq(
      BigInt(userUSDTAmount * 10 ** usdcMintDetails.decimals)
    );
  });

  it("Initialize vault by Admin", async () => {
    const tx = await program.methods
      .initializeVault() // 50% = 5000
      .accounts({
        admin: admin.publicKey,
        usdcMint: usdcMint,
        jupFTokenMint: jupFTokenMint,
        kaminoCollateralMint: kaminoCollateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    console.log("Vault initialized", tx);

    // Fetch and verify vault account
    const vaultAccount = await program.account.vault.fetch(vaultPda);
    assert.equal(vaultAccount.authority.toString(), admin.publicKey.toString());
    assert.equal(vaultAccount.usdcMint.toString(), usdcMint.toString());
    assert.equal(vaultAccount.vaultUsdcAta.toString(), vaultUsdcAta.toString());
    assert(vaultAccount.totalShares.eq(new anchor.BN(0)));
    assert(vaultAccount.accPerShare.eq(new anchor.BN(0)));
    assert(vaultAccount.totalUnderlying.eq(new anchor.BN(0)));
    assert(vaultAccount.jupLendBalance.eq(new anchor.BN(0)));
    assert(vaultAccount.kaminoBalance.eq(new anchor.BN(0)));
    assert(vaultAccount.lastJupValue.eq(new anchor.BN(0)));
    assert(vaultAccount.lastKaminoValue.eq(new anchor.BN(0)));
    assert.equal(vaultAccount.jupAllocation, 5000);
    assert.equal(vaultAccount.kaminoAllocation, 5000);
    assert(vaultAccount.lastUpdateTs.gt(new anchor.BN(0)));
  });

  it("Deposit USDC into vault", async () => {
    const firstDepositAmount = 50 * 10 ** usdcMintDetails.decimals; // 50 USDC
    const secondDepositAmount = 50 * 10 ** usdcMintDetails.decimals; // 50 USDC

    // Check initial balances
    let initialUserUsdcBalance = await getAccount(provider.connection, userUsdcAta, "confirmed");
    let initialVaultUsdcBalance = await getAccount(provider.connection, vaultUsdcAta, "confirmed");

    // First deposit (initialize user position)
    let tx = await program.methods
      .deposit(new anchor.BN(firstDepositAmount))
      .accounts({
        user: user.publicKey,
        vault: vaultPda,
        usdcMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    console.log("First deposit transaction:", tx);

    // Check balances after first deposit
    let userUsdcBalanceAfterFirst = await getAccount(provider.connection, userUsdcAta, "confirmed");
    let vaultUsdcBalanceAfterFirst = await getAccount(provider.connection, vaultUsdcAta, "confirmed");

    // Verify user USDC balance decreased by first amount
    expect(userUsdcBalanceAfterFirst.amount).to.equal(initialUserUsdcBalance.amount - BigInt(firstDepositAmount));

    // Verify vault USDC balance increased by first amount
    expect(vaultUsdcBalanceAfterFirst.amount).to.equal(initialVaultUsdcBalance.amount + BigInt(firstDepositAmount));

    // Verify user position after first deposit
    let userPosition = await program.account.userPosition.fetch(userPositionPda);
    expect(userPosition.shares.toNumber()).to.equal(firstDepositAmount);
    expect(userPosition.rewardDebt.toNumber()).to.equal(0);
    expect(userPosition.vault.equals(vaultPda)).to.be.true;

    // Verify vault state after first deposit
    let vault = await program.account.vault.fetch(vaultPda);
    expect(vault.totalShares.toNumber()).to.equal(firstDepositAmount);
    expect(vault.totalUnderlying.toNumber()).to.equal(firstDepositAmount);
    expect(vault.accPerShare.toNumber()).to.equal(0);

    // Second deposit (existing user position)
    tx = await program.methods
      .deposit(new anchor.BN(secondDepositAmount))
      .accounts({
        user: user.publicKey,
        vault: vaultPda,
        usdcMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    console.log("Second deposit transaction:", tx);

    // Check final balances after second deposit
    const finalUserUsdcBalance = await getAccount(provider.connection, userUsdcAta, "confirmed");
    const finalVaultUsdcBalance = await getAccount(provider.connection, vaultUsdcAta, "confirmed");

    // Verify user USDC balance decreased by total amount
    expect(finalUserUsdcBalance.amount).to.equal(initialUserUsdcBalance.amount - BigInt(firstDepositAmount + secondDepositAmount));

    // Verify vault USDC balance increased by total amount
    expect(finalVaultUsdcBalance.amount).to.equal(initialVaultUsdcBalance.amount + BigInt(firstDepositAmount + secondDepositAmount));

    // Verify user position after second deposit
    userPosition = await program.account.userPosition.fetch(userPositionPda);
    expect(userPosition.shares.toNumber()).to.equal(firstDepositAmount + secondDepositAmount);
    expect(userPosition.rewardDebt.toNumber()).to.equal(0); // Still 0 since accPerShare is 0
    expect(userPosition.vault.equals(vaultPda)).to.be.true;

    // Verify vault state after second deposit
    vault = await program.account.vault.fetch(vaultPda);
    expect(vault.totalShares.toNumber()).to.equal(firstDepositAmount + secondDepositAmount);
    expect(vault.totalUnderlying.toNumber()).to.equal(firstDepositAmount + secondDepositAmount);
    expect(vault.accPerShare.toNumber()).to.equal(0);
  });

  it("Rebalancing USDC to jup and kamino", async () => {
    // TODO : pull this logic to a folder where we are writing the bot 

    // access vault data
    let currentVaultStates = await program.account.vault.fetch(vaultPda, "confirmed");
    let vaultUsdcAtaDetails = await getAccount(provider.connection, vaultUsdcAta);
    let vaultJupAtaDetails = await getAccount(provider.connection, vaultFTokenAta);
    let vaultKaminoAtaDetails = await getAccount(provider.connection, vaultKaminoTokenAta);
    
    const vaultUsdcAtaBalance = new anchor.BN(vaultUsdcAtaDetails.amount); 
    const vaultJupAtaBalance = new anchor.BN(vaultJupAtaDetails.amount);
    const vaultKaminoAtaBalance = new anchor.BN(vaultKaminoAtaDetails.amount);

    // check if this is the first time deposit by check both jup f-token and kamino token amount holdings == 0, if 0 allocate 50-50 to both platforms
    // first time allocation
    if (
      vaultJupAtaBalance.eq(new anchor.BN(0)) 
      && vaultKaminoAtaBalance.eq(new anchor.BN(0)) 
      && vaultUsdcAtaBalance.gt(new anchor.BN(0))
    ){
      // Save these in vault states 
      const jupAllocation = new anchor.BN(5000);
      const kaminoAllocation = new BN(5000);

      let addHalf = vaultUsdcAtaBalance.mul(new BN(5000)).div(new BN(10000));
      console.log("Checking add Half :", addHalf.toString());

      const jupTx = await jupDeposit(program, provider, addHalf, { admin, usdcMint });
      const kamTx = await kaminoDeposit(program, addHalf, { admin, usdcMint });
      console.log("First ever balance...");
      console.log("Jup TX : ", jupTx);
      console.log("Kamino TX :", kamTx);

      const updateVaultStates = await program.methods
        .syncVaultState(
          jupAllocation.toNumber(), // new_jup_allocation
          kaminoAllocation.toNumber(), // new_kamino_allocation
          addHalf, // new_jup_lend_balance
          addHalf, // new_kamino_balance
          new BN(0), // new_acc_per_share
          vaultUsdcAtaBalance, // new_total_underlying
          addHalf, // new_jup_value
          addHalf, // new_kamino_value
        )
        .accounts({
          admin: admin.publicKey
        })
        .signers([admin])
        .rpc();

      console.log("Rebalance completed, vault state updated :", updateVaultStates);
      // update vault states
      // Check if total_underlying is needed 
      // 
      // update jup_allocation, kamino_allocation to 5000
      // update jup_lend_balance, kamino_lend_balance to addHalf (maybe should just add that in the deposit instruction, if we do that we subtract the same in calling instruction)
      // update last_jup_value and last_kamino_value to addHalf
      // update last_update_ts to clock now (we can directly add that in the instruction)

    // } else {
    }
      if(true){ // TODO: remove this and put it inside the else block like commented above, this is for testing purposes only
      // n-th time allocation
      // Check if we need rebalacing
      //  check percent increase in both platforms
      //  if they exceed some percent amount, we perform rebalance or else chill
      // if we need total rebalancing, write rebalance logic + add distrubution logic to rebalancing amount for stored USDC inside main_vault
      // if no rebalancing is required, add lazy distribution logic of USDC in main_vault_usdc_ata accoridng to allocation % (need to confirm if that doesnt interefere with our rebalance logic), will have to update last_jup_value, last_kamino_value according to how much we are pushing in each

      // const lastJupValue = currentVaultStates.lastJupValue;
      // const lastKaminoValue = currentVaultStates.lastKaminoValue;
      // TODO: Remove below values and uncomment above two lines
      const lastJupValue = new BN(48500000) // test values
      const lastKaminoValue = new BN(49700000) // test
      
      vaultJupAtaDetails = await getAccount(provider.connection, vaultFTokenAta); // Updating with the latest deposited amount
      vaultKaminoAtaDetails = await getAccount(provider.connection, vaultKaminoTokenAta);

      const currentJupValue = await convertJupFTokenToUsdcAmount(jupFTokenMint, new BN(vaultJupAtaDetails.amount), provider.connection);
      const currentKaminoValue = await convertKaminoTokenToUsdcAmount(
        new BN(vaultKaminoAtaDetails.amount),
        {
        usdcMint,
        admin: admin.publicKey,
        vaultPda
        }
      )

      // calculate how much % increase is going on in either platform
      // we also have to check that the value is greater than 10000000
      const jupDiff = currentJupValue.sub(lastJupValue);
      let increaseInJup = new BN(0); // init variable 0% -> 157
      console.log("Checking values :", jupDiff.toString(), currentJupValue.toString(), lastJupValue.toString());
      if(!jupDiff.eq(new BN(0))){
        increaseInJup = jupDiff.mul(new BN(10000)).div(lastJupValue);
        // if increaseInJup > 100 i.e. increaseInJup > 1 % and so on...
      }
      console.log("Checking jup diff : ", currentJupValue.toString(), lastKaminoValue.toString(), jupDiff.toString());
      console.log("Checking increase in jup percent value : ", increaseInJup.toString());

      const kamDiff = currentKaminoValue.sub(lastKaminoValue);
      let increaseInKam = new BN(0);  // init with 0 %
      if(!kamDiff.eq(new BN(0))){
        increaseInKam = kamDiff.mul(new BN(10000)).div(lastKaminoValue);
      }
      console.log("Checking kam diff :", currentKaminoValue.toString(), lastKaminoValue.toString(), kamDiff.toString());
      console.log("Checking increase in kamino percent value : ", increaseInKam.toString());

      const getThresholdRequirement = getThresholdAmount({
        increaseInJupPercent : increaseInJup, 
        increaseInKaminoPercent: increaseInKam
      });

      if(getThresholdRequirement.needsRebalance){
        console.log("Checking threhshold function : ", getThresholdRequirement);
        // add rebalancing logic here
      }

      // add lazy balacing

      // according to % increase changes simply follow a static plan and allocate funds

    }

    
  })
})
