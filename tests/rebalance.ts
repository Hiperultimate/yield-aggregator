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
import { invokeRebalance } from "../client_utility/invokeRebalance";

const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Mainnet


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

  it("Rebalancing USDC to jup and kamino for the first time", async () => {
    // access vault data
    await invokeRebalance(program, provider, {
      admin : admin, 
      usdcMint : usdcMint, 
      jupFTokenMint : jupFTokenMint, 
      vaultPda : vaultPda, 
      vaultUsdcAta : vaultUsdcAta, 
      vaultFTokenAta : vaultFTokenAta, 
      vaultKaminoTokenAta : vaultKaminoTokenAta, 
    })
    
    // get vault states
    const vaultState = await program.account.vault.fetch(vaultPda, "confirmed");
    // Expect allocation to be 50-50
    expect(vaultState.jupAllocation).eq(5000);
    expect(vaultState.kaminoAllocation).eq(5000);

    // Expect price distributed to be 50-50
    const vaultJupAtaDetails = await getAccount(provider.connection, vaultFTokenAta, "confirmed");
    const vaultKaminoAtaDetails = await getAccount(provider.connection, vaultKaminoTokenAta, "confirmed");

    const jupAmountInUSDC = await convertJupFTokenToUsdcAmount(jupFTokenMint, new BN(vaultJupAtaDetails.amount), provider.connection);
    const kaminoAmountInUSDC = await convertKaminoTokenToUsdcAmount(new BN(vaultKaminoAtaDetails.amount), {usdcMint, admin : admin.publicKey, vaultPda});
    
    expect(jupAmountInUSDC.sub(new BN(50_000_000)).abs().lte(new BN(100))).to.be.true
    expect(kaminoAmountInUSDC.sub(new BN(50_000_000)).abs().lte(new BN(100))).to.be.true
    
    expect(jupAmountInUSDC.sub(kaminoAmountInUSDC).abs().lte(new BN(100_000_000)));

    const vaultUSDCAtaDetails = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
    expect(new BN(vaultUSDCAtaDetails.amount).sub(new BN(100_000_000)).abs().lte(new BN(100)));
  })
})
