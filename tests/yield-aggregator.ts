import * as anchor from "@coral-xyz/anchor";
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
import { airdropTo, confirmTx, setUSDCViaCheatcode } from "./helper-fns";
import { assert, expect } from "chai";
import { getDepositReserveLiquidityAccounts, initRpc } from "./generate-kamino-accounts";
import { DEFAULT_RECENT_SLOT_DURATION_MS, KaminoMarket } from "@kamino-finance/klend-sdk";
import { Address, createSolanaRpcApi } from "@solana/kit";
// import { getDepositContext } from "@jup-ag/lend/earn";

const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Mainnetb
const JUP_LEND_ADDRESS = "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"; // Mainnet
const KLEND_PROGRAM_ID = new anchor.web3.PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD") as any;

describe("yield-aggregator", () => {
  // Configure the client to use the local cluster.
  const connection = new anchor.web3.Connection(
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
  const jupLendProgram = new Program(
    JupLendIDL,
    provider
  ) as Program<JupLendIDLType>;

  let admin: anchor.web3.Keypair;
  let usdcMint: anchor.web3.PublicKey;
  let usdcMintDetails: Mint;
  let jupFTokenMint: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let allocationConfigPda: anchor.web3.PublicKey;
  let vaultUsdcAta: anchor.web3.PublicKey;
  let vaultFTokenAta: anchor.web3.PublicKey;
  let user: anchor.web3.Keypair;
  let userUsdcAta: anchor.web3.PublicKey;
  let userPositionPda: anchor.web3.PublicKey;

  before(async () => {
    admin = anchor.web3.Keypair.generate();
    const airdropAdminTx = await airdropTo(
      admin.publicKey,
      10,
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

    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), admin.publicKey.toBuffer()],
      program.programId
    );
    [allocationConfigPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("allocation_config"), admin.publicKey.toBuffer()],
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

  it("Program initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });

  it("Initialize vault by Admin", async () => {
    const tx = await program.methods
      .initializeVault(5000, 5000) // 50% = 5000
      .accounts({
        admin: admin.publicKey,
        usdcMint: usdcMint,
        jupFTokenMint: jupFTokenMint,
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
    assert.equal(
      vaultAccount.allocationConfig.toString(),
      allocationConfigPda.toString()
    );
    assert.equal(vaultAccount.totalDeposits.toNumber(), 0);
    assert.equal(vaultAccount.jupLendBalance.toNumber(), 0);
    assert.equal(vaultAccount.kaminoBalance.toNumber(), 0);
    assert.equal(vaultAccount.isActive, true);

    // Fetch and verify allocation config account
    const allocationConfigAccount =
      await program.account.allocationConfig.fetch(allocationConfigPda);
    assert.equal(allocationConfigAccount.vault.toString(), vaultPda.toString());
    assert.deepEqual(allocationConfigAccount.mode, { static: {} }); // Static
    assert.equal(allocationConfigAccount.jupAllocation, 5000);
    assert.equal(allocationConfigAccount.kaminoAllocation, 5000);
    assert.equal(allocationConfigAccount.lastJupYield.toNumber(), 0);
    assert.equal(allocationConfigAccount.lastKaminoYield.toNumber(), 0);

    assert.equal(
      allocationConfigAccount.authority.toString(),
      vaultPda.toString()
    );
  });

  it("Kamino lend call", async () => {
    // const market = await (LendingMarket as any).load(connection, LENDING_MARKET_MAINNET);
    const kaminoMainMarket = new anchor.web3.PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
    const rpc = initRpc('https://api.mainnet-beta.solana.com'); 
    const market = await KaminoMarket.load(rpc as any, kaminoMainMarket.toBase58() as Address, DEFAULT_RECENT_SLOT_DURATION_MS) ;

    // search in another repo as to how can we pass rpc connection in another repo chat
    // const market = await KaminoMarket.load(connection, kaminoMainMarket);
    const reserve = market.getReserveByMint(usdcMint.toBase58() as Address); // assumes market has this method
    const ixAccounts = await getDepositReserveLiquidityAccounts(user.publicKey,reserve.address, kaminoMainMarket.toBase58() as Address, usdcMint.toBase58() as Address);
    
    // console.log("Checking kamino accounts :", ixAccounts);
    console.log("Kamino Accounts");
    for (let key of Object.keys(ixAccounts)){
      console.log(`${key} : ${ixAccounts[key].toBase58()}`)
    }

    // checking user usdc account
    let userUsdcBalance = await getAccount(provider.connection, userUsdcAta, 'confirmed');
    console.log("User USDC balance before:", userUsdcBalance.amount);

    const depositAmount = new anchor.BN(50 * 10 ** 6); // 50 USDC
    const tx = await program.methods
      .depositKamino(depositAmount)
      .accounts({
        owner: user.publicKey,
        reserve: ixAccounts.reserve,
        lendingMarket: ixAccounts.lendingMarket,
        lendingMarketAuthority: ixAccounts.lendingMarketAuthority,
        reserveLiquidityMint: ixAccounts.reserveLiquidityMint,
        reserveLiquiditySupply: ixAccounts.reserveLiquiditySupply,
        reserveCollateralMint: ixAccounts.reserveCollateralMint,
        userSourceLiquidity: ixAccounts.userSourceLiquidity,
        // userDestinationCollateral: ixAccounts.userDestinationCollateral,
        collateralTokenProgram: ixAccounts.collateralTokenProgram,
        liquidityTokenProgram: ixAccounts.liquidityTokenProgram,
        instructionSysvarAccount: ixAccounts.instructionSysvarAccount,
        klendProgram: KLEND_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([user])
      // .rpc();
      .rpc({skipPreflight : true});

    console.log("Kamino deposit transaction:", tx);

    userUsdcBalance = await getAccount(provider.connection, userUsdcAta, 'confirmed');
    console.log("User USDC balance after:", userUsdcBalance.amount);

    // Need to check what am I getting from kamino
    const userKaminoReserveBalance = await getAccount(provider.connection, ixAccounts.userDestinationCollateral,"confirmed" );
    console.log('Checking kamino minted balance : ', userKaminoReserveBalance.amount);
  })

  // it("Deposit Jup Instruction call", async () => {
  //   const { getDepositContext } = await import("@jup-ag/lend/earn");

  //   const jupDepositContext = await getDepositContext({
  //     asset: usdcMint,
  //     connection: provider.connection,
  //     signer: user.publicKey,
  //   });

  //   const usdcDepositAmount = 100;
  //   const depositAmountWithDecimals = new anchor.BN(usdcDepositAmount).mul(
  //     new anchor.BN(10).pow(new anchor.BN(usdcMintDetails.decimals))
  //   );

  //   // Verify initial vault USDC ATA balance is 0
  //   const initialVaultUsdcAta = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
  //   expect(new anchor.BN(initialVaultUsdcAta.amount.toString()).eq(new anchor.BN(0))).to.be.true;

  //   // Execute deposit transaction
  //   const depositTx = await program.methods
  //     .deposit(depositAmountWithDecimals)
  //     .accounts({
  //       admin: admin.publicKey,
  //       // THESE FIELDS ARE DIFFERENT -> signer, depositorTokenAccount, recipientTokenAccount
  //       user: jupDepositContext.signer, // should be the user who is depositing token
  //       depositorTokenAccount: jupDepositContext.depositorTokenAccount,  // should be the user usdc ATA
  //       usdcMint: jupDepositContext.mint,
  //       fTokenMint: jupDepositContext.fTokenMint,
  //       lending: jupDepositContext.lending,
  //       lendingAdmin: jupDepositContext.lendingAdmin,
  //       lendingSupplyPositionOnLiquidity: jupDepositContext.lendingSupplyPositionOnLiquidity,
  //       liquidity: jupDepositContext.liquidity,
  //       liquidityProgram: jupDepositContext.liquidityProgram,
  //       rateModel: jupDepositContext.rateModel,
  //       rewardsRateModel: jupDepositContext.rewardsRateModel,
  //       supplyTokenReservesLiquidity: jupDepositContext.supplyTokenReservesLiquidity,
  //       vault: jupDepositContext.vault,
  //     })
  //     .signers([user])
  //     .rpc({ skipPreflight: true });

  //   console.log("Deposit transaction signature:", depositTx);

  //   // Verify vault USDC ATA balance (remainder after allocation)
  //   const vaultUsdcAtaDetails = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
  //   expect(new anchor.BN(vaultUsdcAtaDetails.amount.toString()).eq(new anchor.BN(50 * 10 ** 6))).to.be.true;

  //   // Verify vault F-token balance (allocated to Jup)
  //   // Note : exchange rate of f-token to USDC is around 1.08 SOL, which is why we are checking a range
  //   const vaultFTokenDetails = await getAccount(provider.connection, vaultFTokenAta, "confirmed");
  //   expect(Number(vaultFTokenDetails.amount)).to.be.closeTo(50 * 10 ** 6, 2 * 10 ** 6);

  //   // Verify user position creation/update
  //   const userPosition = await program.account.userPosition.fetch(userPositionPda);
  //   expect(userPosition.depositedAmount.eq(depositAmountWithDecimals), "User deposited amount not matching").to.be.true;
  //   expect(userPosition.earnedYield.eq(new anchor.BN(0)), "User earned yield should be initialized to 0").to.be.true;
  //   expect(userPosition.vault.equals(vaultPda), "User position vault should exist and match with vaultPda public key").to.be.true; // why is this failing

  //   // Verify vault state update
  //   const vault = await program.account.vault.fetch(vaultPda);
  //   expect(vault.totalDeposits.eq(depositAmountWithDecimals), "Vault total deposit should now be increased from 0 to deposited amount").to.be.true;
  //   expect(vault.jupLendBalance.toNumber(), "Vault's jup lend balance should be exactly half of the initial payment because of the current balance percent").eq(50 * 10 ** 6);
  //   expect(vault.kaminoBalance.toNumber(), "Vault's kamino balance should be exactly half of the initial payment because of the current balance percent").eq(50 * 10 ** 6);

  //   // Verify user USDC balance decrease
  //   const userUsdcDetails = await getAccount(provider.connection, userUsdcAta, "confirmed");
  //   const initialUserBalance = 1000 * 10 ** usdcMintDetails.decimals;
  //   const expectedUserBalance = initialUserBalance - usdcDepositAmount * 10 ** usdcMintDetails.decimals;
  //   expect(new anchor.BN(userUsdcDetails.amount.toString()).eq(new anchor.BN(expectedUserBalance))).to.be.true;

  //   // Verify allocation config remains unchanged
  //   const allocConfig = await program.account.allocationConfig.fetch(allocationConfigPda);
  //   expect(allocConfig.jupAllocation).to.equal(5000);
  //   expect(allocConfig.kaminoAllocation).to.equal(5000);
  //   expect(allocConfig.lastJupYield.eq(new anchor.BN(0))).to.be.true;
  //   expect(allocConfig.lastKaminoYield.eq(new anchor.BN(0))).to.be.true;
  // })
})
