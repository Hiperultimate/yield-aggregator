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
// import { getDepositContext } from "@jup-ag/lend/earn";

const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Mainnetb
const JUP_LEND_ADDRESS = "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"; // Mainnet

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

    // Check how much USDC does provider.wallet has
    // const mainWallet = provider.wallet;
    // await setUSDCViaCheatcode(mainWallet.publicKey.toBase58(), 500, usdcMintDetails);
    // const mainWalletUSDCAta = getAssociatedTokenAddressSync(usdcMint, mainWallet.publicKey, false);
    // const maintWalletUSDCAtaDetails = await getAccount(provider.connection, mainWalletUSDCAta, "confirmed");

    // This may be un-required later on
    // get the mint address from jup lend sdk
    // get jupFtoken mint details using getMint

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
      10,
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

  it("Checking if default jup call is working or not", async () => {
    const { getDepositContext } = await import("@jup-ag/lend/earn");

    const jupDepositContext = await getDepositContext({
      asset: usdcMint,
      connection: provider.connection,
      signer: user.publicKey,
    });

    const usdcDepositAmount = 100;
    const usdcAmountWithDecimals = new anchor.BN(usdcDepositAmount).mul(
      new anchor.BN(10).pow(new anchor.BN(usdcMintDetails.decimals))
    );

    console.log("Signer details : ", user.publicKey.toString());
    console.log("Jup Signer details : ", jupDepositContext.signer.toString());

    const accountsToCheck = [
      jupDepositContext.depositorTokenAccount,
      jupDepositContext.fTokenMint,
      jupDepositContext.lending,
      jupDepositContext.lendingAdmin,
      jupDepositContext.lendingBorrowPositionOnLiquidity,
      jupDepositContext.liquidity,
      new anchor.web3.PublicKey(JUP_LEND_ADDRESS),
      jupDepositContext.liquidityProgram,
      jupDepositContext.mint,
      jupDepositContext.rateModel,
      jupDepositContext.recipientTokenAccount,
      jupDepositContext.rewardsRateModel,
      jupDepositContext.signer,
      jupDepositContext.supplyTokenReservesLiquidity,
      jupDepositContext.systemProgram,
      jupDepositContext.tokenProgram,
      jupDepositContext.vault,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ];

    for (const account of accountsToCheck) {
      try {
        const info = await connection.getAccountInfo(account);
        if (!info) {
          console.log(`Account ${account.toString()} does not exist`);
        } else {
          console.log(`Account ${account.toString()} exists`);
        }
      } catch (error) {
        console.log(
          `Error checking account ${account.toString()}: ${error.message}`
        );
      }
    }

    // Check user USDT balance here
    let mainVaultUSDCAta = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
    console.log("User USDT ATA address : ", mainVaultUSDCAta.address.toBase58());
    console.log("Checking current user ATA USDC balance :", mainVaultUSDCAta.amount);

    const depositTx = await program.methods
      .depositJup(usdcAmountWithDecimals)
      .accounts({
        admin: admin.publicKey,
        
        // THESE FIELDS ARE DIFFERENT -> signer, depositorTokenAccount, recipientTokenAccount
        signer: jupDepositContext.signer, // should be the user who is depositing token
        depositorTokenAccount: jupDepositContext.depositorTokenAccount,  // should be the user usdc ATA
        // recipientTokenAccount: jupDepositContext.recipientTokenAccount, // should be vault f token vault
        // signerTokenAccount: jupDepositContext.recipientTokenAccount,
        mint: jupDepositContext.mint,
        
        fTokenMint: jupDepositContext.fTokenMint,
        lending: jupDepositContext.lending,
        lendingAdmin: jupDepositContext.lendingAdmin,
        lendingSupplyPositionOnLiquidity:
          jupDepositContext.lendingSupplyPositionOnLiquidity,
        liquidity: jupDepositContext.liquidity,
        lendingProgram: new anchor.web3.PublicKey(JUP_LEND_ADDRESS),
        liquidityProgram: jupDepositContext.liquidityProgram,
        rateModel: jupDepositContext.rateModel,
        rewardsRateModel: jupDepositContext.rewardsRateModel,
        supplyTokenReservesLiquidity:
          jupDepositContext.supplyTokenReservesLiquidity,
        vault: jupDepositContext.vault,
      })
      .signers([user])
      .rpc({ skipPreflight: true });

    console.log("Jup tx check : ", depositTx);

    mainVaultUSDCAta = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
    console.log("User USDT ATA address : ", mainVaultUSDCAta.address.toBase58());
    console.log("Checking current user ATA USDC balance :", mainVaultUSDCAta.amount);

    // check how much ftoken do main_vault have
    const vaultFTokenDetails = await getAccount(provider.connection, vaultFTokenAta, "confirmed");
    console.log("Vault F token ATA address : ", vaultFTokenDetails.address.toBase58());
    console.log("Checking vault FToken balance : ", vaultFTokenDetails.amount);
  });

  // it("User deposits USDC to vault", async () => {
  //   // Transfer 100 USDC from user
  //   const usdcDepositAmount = 100;
  //   const usdcAmountWithDecimals = new anchor.BN(usdcDepositAmount).mul(
  //     new anchor.BN(10).pow(new anchor.BN(usdcMintDetails.decimals))
  //   );

  //   const { getDepositContext } = await import("@jup-ag/lend/earn");

  //   // const checking = getAssociatedTokenAddressSync(usdcMint, vaultPda);
  //   const jupDepositContext = await getDepositContext({
  //     asset: usdcMint,
  //     connection: provider.connection,
  //     signer: user.publicKey, // TODO : change this to main_vault
  //     // signer: vaultPda, // TODO : change this to main_vault
  //   });

  //   const depositTx = await program.methods.deposit(usdcAmountWithDecimals)
  //     .accounts({
  //       user: user.publicKey,
  //       admin : admin.publicKey,
  //       usdcMint: usdcMint,

  //       fTokenMint : jupDepositContext.fTokenMint,
  //       lendingAdmin: jupDepositContext.lendingAdmin,
  //       lending: jupDepositContext.lending,
  //       supplyTokenReservesLiquidity : jupDepositContext.supplyTokenReservesLiquidity,
  //       lendingSupplyPositionOnLiquidity: jupDepositContext.lendingSupplyPositionOnLiquidity,
  //       rateModel: jupDepositContext.rateModel,
  //       vault: jupDepositContext.vault,
  //       liquidity: jupDepositContext.liquidity,
  //       liquidityProgram: jupDepositContext.liquidityProgram,
  //       rewardsRateModel: jupDepositContext.rewardsRateModel,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //     })
  //     .signers([user])
  //     .rpc();

  //   // const depositTx = await program.methods
  //   //   .deposit(usdcAmountWithDecimals)
  //   //   .accounts({
  //   //     user: user.publicKey,
  //   //     admin: admin.publicKey,
  //   //     usdcMint: usdcMint,

  //   //     fTokenMint: jupDepositContext.fTokenMint,
  //   //     lendingAdmin: jupDepositContext.lendingAdmin,
  //   //     lending: jupDepositContext.lending,
  //   //     supplyTokenReservesLiquidity: jupDepositContext.supplyTokenReservesLiquidity,
  //   //     lendingSupplyPositionOnLiquidity: jupDepositContext.lendingSupplyPositionOnLiquidity,
  //   //     rateModel: jupDepositContext.rateModel,
  //   //     vault: jupDepositContext.vault,
  //   //     liquidity: jupDepositContext.liquidity,
  //   //     liquidityProgram: jupDepositContext.liquidityProgram,
  //   //     rewardsRateModel: jupDepositContext.rewardsRateModel,
  //   //     tokenProgram: TOKEN_PROGRAM_ID,
  //   //     // jupLendingProgram: new anchor.web3.PublicKey(JUP_LEND_ADDRESS),
  //   //   })
  //   //   .signers([user])
  //   //   .transaction();

  //   // const sim = await connection.simulateTransaction(depositTx);
  //   // try {
  //   //   const sim = await provider.simulate(depositTx, [user]);
  //   //   console.log("Success LOGS:", sim.logs);
  //   // } catch (error) {
  //   //   console.log("ERROR LOGS : ", error);
  //   // }

  //   // console.log("Jup deposited complete ?! : ", depositTx);
  // });
});
