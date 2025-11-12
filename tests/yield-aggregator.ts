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
import {
    Connection,
} from "@solana/web3.js";
import { airdropTo, confirmTx, setUSDCViaCheatcode, convertJupFTokenToUsdcAmount, convertKaminoTokenToUsdcAmount, getThresholdAmount } from "../client_utility/helper-fns";
import { assert, expect } from "chai";
import { getDepositReserveLiquidityAccounts, initRpc } from "../client_utility/generate-kamino-accounts";
import { DEFAULT_RECENT_SLOT_DURATION_MS, KaminoMarket } from "@kamino-finance/klend-sdk";
import { Address } from "@solana/kit";

const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Mainnetb
const JUP_LEND_ADDRESS = "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"; // Mainnet
const KLEND_PROGRAM_ID = new anchor.web3.PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD") as any;

describe("Yield aggregator instruction tests", () => {
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

  it("Depositing USDC from vault_usdc_ata to Jup", async () => {
    // Get Jup accounts
    const { getDepositContext } = await import("@jup-ag/lend/earn");
    const jupDepositContext = await getDepositContext({
      asset: usdcMint,
      connection: provider.connection,
      signer: admin.publicKey,
    });

    // Check if vault USDC ATA exists and has USDC
    let vaultUsdcAtaAccount = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
    expect(vaultUsdcAtaAccount.amount > BigInt(0)).to.be.true;
    const initialUsdcBalance = vaultUsdcAtaAccount.amount;
    console.log("Vault USDC ATA amount before:", initialUsdcBalance);

    // Check vault F-token ATA balance before
    let vaultFTokenAtaAccount = await getAccount(provider.connection, vaultFTokenAta, "confirmed");
    const initialFTokenBalance = vaultFTokenAtaAccount.amount;
    console.log("Vault F-token ATA amount before:", initialFTokenBalance);

    // Call jup_deposit
    const depositAmount = 50000000; // 50 USDC
    const tx = await program.methods
      .jupDeposit(new anchor.BN(depositAmount))
      .accounts({
        admin: admin.publicKey,
        usdcMint: usdcMint,
        fTokenMint: jupDepositContext.fTokenMint,
        lendingAdmin: jupDepositContext.lendingAdmin,
        lending: jupDepositContext.lending,
        supplyTokenReservesLiquidity: jupDepositContext.supplyTokenReservesLiquidity,
        lendingSupplyPositionOnLiquidity: jupDepositContext.lendingSupplyPositionOnLiquidity,
        rateModel: jupDepositContext.rateModel,
        vault: jupDepositContext.vault,
        liquidity: jupDepositContext.liquidity,
        liquidityProgram: jupDepositContext.liquidityProgram,
        rewardsRateModel: jupDepositContext.rewardsRateModel,
      })
      .signers([admin])
      .rpc({skipPreflight: true});

    console.log("Jup deposit transaction:", tx);

    // Check balances after
    vaultUsdcAtaAccount = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
    console.log("Vault USDC ATA amount after:", vaultUsdcAtaAccount.amount);
    expect(vaultUsdcAtaAccount.amount).to.equal(initialUsdcBalance - BigInt(depositAmount));

    vaultFTokenAtaAccount = await getAccount(provider.connection, vaultFTokenAta, "confirmed");
    console.log("Vault F-token ATA amount after:", vaultFTokenAtaAccount.amount);
    expect(vaultFTokenAtaAccount.amount > initialFTokenBalance).to.be.true; // Should have received f-tokens
  });

  it("Depositing USDC from vault_usdc_ata to Kamino", async () => {
    // Get Kamino accounts
    const kaminoMainMarket = new anchor.web3.PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
    const rpc = initRpc('http://localhost:8899');
    const market = await KaminoMarket.load(rpc as any, kaminoMainMarket.toBase58() as Address, DEFAULT_RECENT_SLOT_DURATION_MS);
    const reserve = market.getReserveByMint(usdcMint.toBase58() as Address);
    const ixAccounts = await getDepositReserveLiquidityAccounts(user.publicKey, reserve.address, kaminoMainMarket.toBase58() as Address, usdcMint.toBase58() as Address);
    const vaultKaminoAta = await getAssociatedTokenAddress(new anchor.web3.PublicKey(ixAccounts.reserveCollateralMint), vaultPda, true);

    // Check user USDC balance
    const vaultUsdcBalance = await getAccount(provider.connection, vaultUsdcAta, 'confirmed');
    console.log("Vault USDC balance before:", vaultUsdcBalance.amount);
    expect(vaultUsdcBalance.amount > BigInt(0)).to.be.true;

    const depositAmount = new anchor.BN(50 * 10 ** 6); // 50 USDC
    const tx = await program.methods
      .kaminoDeposit(depositAmount)
      .accounts({
        admin: admin.publicKey,
        usdcMint: usdcMint,
        reserve: ixAccounts.reserve,
        lendingMarket: ixAccounts.lendingMarket,
        lendingMarketAuthority: ixAccounts.lendingMarketAuthority,
        reserveLiquiditySupply: ixAccounts.reserveLiquiditySupply,
        reserveCollateralMint: ixAccounts.reserveCollateralMint,
        collateralTokenProgram: ixAccounts.collateralTokenProgram,
        liquidityTokenProgram: ixAccounts.liquidityTokenProgram,
        instructionSysvarAccount: ixAccounts.instructionSysvarAccount,
        klendProgram: KLEND_PROGRAM_ID,
      })
      .signers([admin])
      .rpc({skipPreflight: true});

    console.log("Kamino deposit transaction:", tx);

    // Check balances after
    const vaultUsdcBalanceAfter = await getAccount(provider.connection, vaultUsdcAta, 'confirmed');
    console.log("User USDC balance after:", vaultUsdcBalanceAfter.amount);
    expect(Number(vaultUsdcBalanceAfter.amount)).to.be.closeTo(Number(vaultUsdcBalance.amount) - depositAmount.toNumber(), 10);

    // Check collateral tokens received
    const collateralAta = await getAccount(provider.connection, vaultKaminoAta, 'confirmed');
    console.log("Vault ATA amount kamino collateral token:", collateralAta.amount);
    expect(collateralAta.amount > BigInt(0)).to.be.true; // Should have received collateral tokens
  });

  it("Withdrawing USDC from vault_kamino_ata to Kamino", async () => {
    // Get Kamino accounts
    const kaminoMainMarket = new anchor.web3.PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
    const rpc = initRpc('http://localhost:8899');
    const market = await KaminoMarket.load(rpc as any, kaminoMainMarket.toBase58() as Address, DEFAULT_RECENT_SLOT_DURATION_MS);
    const reserve = market.getReserveByMint(usdcMint.toBase58() as Address);
    const ixAccounts = await getDepositReserveLiquidityAccounts(admin.publicKey, reserve.address, kaminoMainMarket.toBase58() as Address, usdcMint.toBase58() as Address);
    const vaultKaminoAta = await getAssociatedTokenAddress(new anchor.web3.PublicKey(ixAccounts.reserveCollateralMint), vaultPda, true);

    // Check collateral balance before
    const collateralAtaBefore = await getAccount(provider.connection, vaultKaminoAta, 'confirmed');
    console.log("Vault collateral before withdraw:", collateralAtaBefore.amount);
    expect(collateralAtaBefore.amount > BigInt(0)).to.be.true;

    // Check vault USDC balance before
    const vaultUsdcBalanceBefore = await getAccount(provider.connection, vaultUsdcAta, 'confirmed');
    console.log("Vault USDC before withdraw:", vaultUsdcBalanceBefore.amount);

    // Withdraw all collateral tokens
    const withdrawAmount = new anchor.BN(collateralAtaBefore.amount.toString());
    const tx = await program.methods
      .kaminoWithdraw(withdrawAmount)
      .accounts({
        admin: admin.publicKey,
        usdcMint: usdcMint,
        reserve: ixAccounts.reserve,
        lendingMarket: ixAccounts.lendingMarket,
        lendingMarketAuthority: ixAccounts.lendingMarketAuthority,
        reserveLiquiditySupply: ixAccounts.reserveLiquiditySupply,
        reserveCollateralMint: ixAccounts.reserveCollateralMint,
        collateralTokenProgram: ixAccounts.collateralTokenProgram,
        liquidityTokenProgram: ixAccounts.liquidityTokenProgram,
        instructionSysvarAccount: ixAccounts.instructionSysvarAccount,
        klendProgram: KLEND_PROGRAM_ID,
      })
      .signers([admin])
      .rpc({skipPreflight: true});

    console.log("Kamino withdraw transaction:", tx);

    // Check balances after
    const vaultUsdcBalanceAfter = await getAccount(provider.connection, vaultUsdcAta, 'confirmed');
    console.log("Vault USDC after withdraw:", vaultUsdcBalanceAfter.amount);
    expect(vaultUsdcBalanceAfter.amount > vaultUsdcBalanceBefore.amount).to.be.true; // Should have received USDC

    const collateralAtaAfter = await getAccount(provider.connection, vaultKaminoAta, 'confirmed');
    console.log("Vault collateral after withdraw:", collateralAtaAfter.amount);
    expect(collateralAtaAfter.amount).to.equal(BigInt(0)); // Should have burned all collateral
  });

  it("Withdrawing USDC from Jup to main_vault_usdc_ata", async () => {
    // Get Jup withdraw accounts
    const { getWithdrawContext } = await import("@jup-ag/lend/earn");
    const jupWithdrawContext = await getWithdrawContext({
      asset: usdcMint,
      connection: provider.connection,
      signer: admin.publicKey,
    });

    // Check vault F-token balance before
    let vaultFTokenAtaAccount = await getAccount(provider.connection, vaultFTokenAta, "confirmed");
    const initialFTokenBalance = vaultFTokenAtaAccount.amount;
    console.log("Vault F-token before :", initialFTokenBalance);
    expect(initialFTokenBalance > BigInt(0)).to.be.true; // Should have f-tokens from deposit

    const existingUSDCValueInVault = await convertJupFTokenToUsdcAmount(jupFTokenMint, new anchor.BN(initialFTokenBalance), connection);
    console.log("Vault USDC before : ", existingUSDCValueInVault.toNumber());

    // Check vault USDC balance before
    let vaultUsdcAtaAccount = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
    const initialUsdcBalance = vaultUsdcAtaAccount.amount;
    // console.log("Vault USDC ATA amount before withdraw:", initialUsdcBalance);

    // const withdrawAmount = new anchor.BN(initialFTokenBalance);  // 50 USDC worth of f-tokens
    const tx = await program.methods
      .jupWithdraw(existingUSDCValueInVault.sub(new anchor.BN(50)))
      .accounts({
        admin: admin.publicKey,
        usdcMint: usdcMint,
        fTokenMint: jupWithdrawContext.fTokenMint,
        lendingAdmin: jupWithdrawContext.lendingAdmin,
        lending: jupWithdrawContext.lending,
        supplyTokenReservesLiquidity: jupWithdrawContext.supplyTokenReservesLiquidity,
        lendingSupplyPositionOnLiquidity: jupWithdrawContext.lendingSupplyPositionOnLiquidity,
        rateModel: jupWithdrawContext.rateModel,
        claimAccount : jupWithdrawContext.claimAccount,
        vault: jupWithdrawContext.vault,
        liquidity: jupWithdrawContext.liquidity,
        liquidityProgram: jupWithdrawContext.liquidityProgram,
        rewardsRateModel: jupWithdrawContext.rewardsRateModel
      })
      .signers([admin])
      .rpc({skipPreflight: true});

    console.log("Jup withdraw transaction:", tx);

    // Check balances after
    vaultUsdcAtaAccount = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
    console.log("Vault USDC after :", vaultUsdcAtaAccount.amount);
    expect(Number(vaultUsdcAtaAccount.amount)).to.be.closeTo(Number(initialUsdcBalance) + 50 * 10 ** 6, 100); // Allow small delta due to protocol fees/rounding

    vaultFTokenAtaAccount = await getAccount(provider.connection, vaultFTokenAta, "confirmed");
    console.log("Vault F-token after :", vaultFTokenAtaAccount.amount);

    expect(vaultFTokenAtaAccount.amount < initialFTokenBalance).to.be.true; // Should have burned f-tokens
  });


  // TODO : Remove below code after completion
  // Old tests, may require as a lookup in future
  // it("Rebalancing with Jup and Kamino", async () => {
  //   // Get Jup accounts
  //   const { getDepositContext } = await import("@jup-ag/lend/earn");
  //   const jupDepositContext = await getDepositContext({
  //     asset: usdcMint,
  //     connection: provider.connection,
  //     signer: admin.publicKey, // using user to get static account addres
  //   });

  //   // Get Kamino accounts
  //   const kaminoMainMarket = new anchor.web3.PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
  //   const rpc = initRpc('https://api.mainnet-beta.solana.com');
  //   const market = await KaminoMarket.load(rpc as any, kaminoMainMarket.toBase58() as Address, DEFAULT_RECENT_SLOT_DURATION_MS);
  //   const reserve = market.getReserveByMint(usdcMint.toBase58() as Address);
  //   const ixAccounts = await getDepositReserveLiquidityAccounts(admin.publicKey, reserve.address, kaminoMainMarket.toBase58() as Address, usdcMint.toBase58() as Address); // using admin as owner here, NOTE : we are not passing this objects userSourceLiquidity and userDestinationCollateral which is related to owner

  //   // Check if vault USDC ATA exists and has USDC
  //   const vaultUsdcAtaAccount = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
  //   expect(vaultUsdcAtaAccount.amount > BigInt(0)).to.be.true; // Should have USDC from deposits
  //   console.log("main vulat USDC ATA : ", vaultUsdcAtaAccount.amount);

  //   // Check if vault F-token ATA exists
  //   const vaultFTokenAtaAccount = await getAccount(provider.connection, vaultFTokenAta, "confirmed");
  //   expect(vaultFTokenAtaAccount.owner.toBase58()).eq(vaultPda.toBase58())
  //   expect(vaultFTokenAtaAccount.amount >= BigInt(0)).to.be.true; // Should exist, balance may be 0

  //   // // Call rebalance
  //   const tx = await program.methods
  //     .rebalance()
  //     .accounts({
  //       admin: admin.publicKey,
  //       usdcMint: usdcMint,
  //       fTokenMint: jupDepositContext.fTokenMint,
  //       lendingAdmin: jupDepositContext.lendingAdmin,
  //       lending: jupDepositContext.lending,
  //       supplyTokenReservesLiquidity: jupDepositContext.supplyTokenReservesLiquidity,
  //       lendingSupplyPositionOnLiquidity: jupDepositContext.lendingSupplyPositionOnLiquidity,
  //       rateModel: jupDepositContext.rateModel,
  //       vault: jupDepositContext.vault,
  //       liquidity: jupDepositContext.liquidity,
  //       liquidityProgram: jupDepositContext.liquidityProgram,
  //       rewardsRateModel: jupDepositContext.rewardsRateModel,
        
  //       reserve: ixAccounts.reserve,
  //       lendingMarket: ixAccounts.lendingMarket,
  //       lendingMarketAuthority: ixAccounts.lendingMarketAuthority,
  //       reserveLiquiditySupply: ixAccounts.reserveLiquiditySupply,
  //       reserveCollateralMint: ixAccounts.reserveCollateralMint,
  //       // userDestinationCollateral: ixAccounts.userDestinationCollateral,
  //       collateralTokenProgram: ixAccounts.collateralTokenProgram,
  //       liquidityTokenProgram: ixAccounts.liquidityTokenProgram,
  //       instructionSysvarAccount: ixAccounts.instructionSysvarAccount,
  //       klendProgram: KLEND_PROGRAM_ID,

        
  //     })
  //     .signers([admin])
  //     .rpc({skipPreflight: true});

  //   console.log("Rebalance transaction:", tx);
  // });

  // it("Kamino lend call", async () => {
  //   // const market = await (LendingMarket as any).load(connection, LENDING_MARKET_MAINNET);
  //   const kaminoMainMarket = new anchor.web3.PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
  //   const rpc = initRpc('https://api.mainnet-beta.solana.com'); 
  //   const market = await KaminoMarket.load(rpc as any, kaminoMainMarket.toBase58() as Address, DEFAULT_RECENT_SLOT_DURATION_MS) ;

  //   // search in another repo as to how can we pass rpc connection in another repo chat
  //   // const market = await KaminoMarket.load(connection, kaminoMainMarket);
  //   const reserve = market.getReserveByMint(usdcMint.toBase58() as Address); // assumes market has this method
  //   const ixAccounts = await getDepositReserveLiquidityAccounts(user.publicKey,reserve.address, kaminoMainMarket.toBase58() as Address, usdcMint.toBase58() as Address);
    
  //   // console.log("Checking kamino accounts :", ixAccounts);
  //   console.log("Kamino Accounts");
  //   for (let key of Object.keys(ixAccounts)){
  //     console.log(`${key} : ${ixAccounts[key].toBase58()}`)
  //   }

  //   // checking user usdc account
  //   let userUsdcBalance = await getAccount(provider.connection, userUsdcAta, 'confirmed');
  //   console.log("User USDC balance before:", userUsdcBalance.amount);

  //   const depositAmount = new anchor.BN(50 * 10 ** 6); // 50 USDC
  //   const tx = await program.methods
  //     .depositKamino(depositAmount)
  //     .accounts({
  //       owner: user.publicKey,
  //       reserve: ixAccounts.reserve,
  //       lendingMarket: ixAccounts.lendingMarket,
  //       lendingMarketAuthority: ixAccounts.lendingMarketAuthority,
  //       reserveLiquidityMint: ixAccounts.reserveLiquidityMint,
  //       reserveLiquiditySupply: ixAccounts.reserveLiquiditySupply,
  //       reserveCollateralMint: ixAccounts.reserveCollateralMint,
  //       userSourceLiquidity: ixAccounts.userSourceLiquidity,
  //       // userDestinationCollateral: ixAccounts.userDestinationCollateral,
  //       collateralTokenProgram: ixAccounts.collateralTokenProgram,
  //       liquidityTokenProgram: ixAccounts.liquidityTokenProgram,
  //       instructionSysvarAccount: ixAccounts.instructionSysvarAccount,
  //       klendProgram: KLEND_PROGRAM_ID,
  //       tokenProgram: TOKEN_PROGRAM_ID
  //     })
  //     .signers([user])
  //     // .rpc();
  //     .rpc({skipPreflight : true});

  //   console.log("Kamino deposit transaction:", tx);

  //   userUsdcBalance = await getAccount(provider.connection, userUsdcAta, 'confirmed');
  //   console.log("User USDC balance after:", userUsdcBalance.amount);

  //   // Need to check what am I getting from kamino
  //   const userKaminoReserveBalance = await getAccount(provider.connection, ixAccounts.userDestinationCollateral,"confirmed" );
  //   console.log('Checking kamino minted balance : ', userKaminoReserveBalance.amount);
  // })

  //   // it("Deposit Jup and Kamino Instruction call", async () => {
  //   const { getDepositContext } = await import("@jup-ag/lend/earn");

  //   const jupDepositContext = await getDepositContext({
  //     asset: usdcMint,
  //     connection: provider.connection,
  //     signer: user.publicKey,
  //   });

  //   const kaminoMainMarket = new anchor.web3.PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
  //   const rpc = initRpc('https://api.mainnet-beta.solana.com');
  //   const market = await KaminoMarket.load(rpc as any, kaminoMainMarket.toBase58() as Address, DEFAULT_RECENT_SLOT_DURATION_MS) ;

  //   // search in another repo as to how can we pass rpc connection in another repo chat
  //   // const market = await KaminoMarket.load(connection, kaminoMainMarket);
  //   const reserve = market.getReserveByMint(usdcMint.toBase58() as Address); // assumes market has this method
  //   const ixAccounts = await getDepositReserveLiquidityAccounts(user.publicKey,reserve.address, kaminoMainMarket.toBase58() as Address, usdcMint.toBase58() as Address);


  //   const usdcDepositAmount = 100;
  //   const depositAmountWithDecimals = new anchor.BN(usdcDepositAmount).mul(
  //     new anchor.BN(10).pow(new anchor.BN(usdcMintDetails.decimals))
  //   );

  //   // Verify initial vault USDC ATA balance is 0
  //   const initialVaultUsdcAta = await getAccount(provider.connection, vaultUsdcAta, "confirmed");
  //   expect(new anchor.BN(initialVaultUsdcAta.amount.toString()).eq(new anchor.BN(0))).to.be.true;

  //   // checking user usdc account
  //   let userUsdcBalance = await getAccount(provider.connection, userUsdcAta, 'confirmed');
  //   console.log("User USDC balance before:", userUsdcBalance.amount);

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

  //       reserve: ixAccounts.reserve,
  //       lendingMarket: ixAccounts.lendingMarket,
  //       lendingMarketAuthority: ixAccounts.lendingMarketAuthority,
  //       reserveLiquiditySupply: ixAccounts.reserveLiquiditySupply,
  //       reserveCollateralMint: ixAccounts.reserveCollateralMint,
  //       userSourceLiquidity: ixAccounts.userSourceLiquidity,
  //       // userDestinationCollateral: ixAccounts.userDestinationCollateral,
  //       collateralTokenProgram: ixAccounts.collateralTokenProgram,
  //       liquidityTokenProgram: ixAccounts.liquidityTokenProgram,
  //       instructionSysvarAccount: ixAccounts.instructionSysvarAccount,
  //       klendProgram: KLEND_PROGRAM_ID,
  //     })
  //     .signers([user])
  //     .rpc({ skipPreflight: true });

  //   console.log("Deposit transaction signature:", depositTx);

  //       // checking user usdc account
  //   userUsdcBalance = await getAccount(provider.connection, userUsdcAta, 'confirmed');
  //   console.log("User USDC balance after:", userUsdcBalance.amount);

  //   // Need to check what am I getting from kamino
  //   const userKaminoReserveBalance = await getAccount(provider.connection, ixAccounts.userDestinationCollateral,"confirmed" );
  //   console.log('Checking kamino minted balance : ', userKaminoReserveBalance.amount);

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
