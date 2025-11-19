import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { YieldAggregator } from "../target/types/yield_aggregator";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { convertUsdcToJupFTokenAmount } from "./helper-fns";
import { initRpc } from "./generate-kamino-accounts";
import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  KaminoMarket,
} from "@kamino-finance/klend-sdk";
import { Address } from "@solana/kit";
import Decimal from "decimal.js";
import { jupWithdraw } from "./instructionCalls/jupWithdraw";
import { kaminoWithdraw } from "./instructionCalls/kaminoWithdraw";

const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Mainnet

// NOTE : Client side withdraw logic will be on hiatus for now
// This transfer instruction will be invoked via frontend
export async function invokeClientWithdraw(
  program: Program<YieldAggregator>,
  provider: anchor.AnchorProvider,
  withdrawAmount: anchor.BN, // in smallest units, e.g., 12309000 for ~12.309 USDC
  accounts: {
    admin: anchor.web3.Keypair;
    user: anchor.web3.Keypair;
    jupFTokenMint: anchor.web3.PublicKey;
    kaminoCollateralMint: anchor.web3.PublicKey;
    vaultPda: anchor.web3.PublicKey;
  }
) {
  const connection = provider.connection;
  const usdcMint = new anchor.web3.PublicKey(USDC_MINT_ADDRESS);

  // Get vault state
  const vaultAccount = await program.account.vault.fetch(accounts.vaultPda);

  // Get current allocation percentages
  const jupAllocation = vaultAccount.jupAllocation;
  const kaminoAllocation = vaultAccount.kaminoAllocation;
  const scale = 10000;

  // Compute how much USDC to withdraw from each platform
  const jupWithdrawUsdc = withdrawAmount
    .mul(new BN(jupAllocation))
    .div(new BN(scale));
  const kaminoWithdrawUsdc = withdrawAmount
    .mul(new BN(kaminoAllocation))
    .div(new BN(scale));

  // Get Jup exchange rate and compute f-token amount
  const jupTokenAmount = await convertUsdcToJupFTokenAmount(
    accounts.jupFTokenMint,
    jupWithdrawUsdc,
    connection
  );

  // Get Kamino exchange rate and compute collateral token amount
  const kaminoMainMarket = new anchor.web3.PublicKey(
    "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
  );
  const rpc = initRpc("http://localhost:8899");
  const market = await KaminoMarket.load(
    rpc as any,
    kaminoMainMarket.toBase58() as Address,
    DEFAULT_RECENT_SLOT_DURATION_MS
  );
  const reserve = market.getReserveByMint(usdcMint.toBase58() as Address);

  const exchangeRate = reserve.getCollateralExchangeRate();
  const multiplier = new Decimal(10).pow(18);
  const exchangeRateNonDecimal = exchangeRate.mul(multiplier).floor();
  const exchangeRateBN = new anchor.BN(exchangeRateNonDecimal.toFixed(0));

  // To get collateral token amount from USDC: collateralAmount = (usdcAmount * exchangeRateBN) / 10^18
  const kaminoTokenAmount = kaminoWithdrawUsdc
    .mul(exchangeRateBN)
    .div(new BN(10).pow(new BN(18)));

  // Perform actual withdrawals from Jup + Kamino (these will deposit to vault USDC ATA)
  // Jup withdraw
  const jupTx = await jupWithdraw(program, provider, jupTokenAmount, {
    admin: accounts.admin,
    usdcMint,
  });

  // Kamino withdraw
  const kaminoTx = await kaminoWithdraw(program, kaminoTokenAmount, {
    admin: accounts.admin,
    usdcMint,
  });

  // Compute yield (acc_per_share logic)
  const SCALER = new BN(10).pow(new BN(12)); // 1e12 precision
  const totalUnderlyingBefore = vaultAccount.totalUnderlying;
  const totalUnderlyingAfter = totalUnderlyingBefore.sub(withdrawAmount);

  // Yield from this withdrawal (if any)
  const yieldGenerated = totalUnderlyingBefore.sub(totalUnderlyingAfter);

  // Increment acc_per_share (scaled)
  let accIncrement = new BN(0);
  if (yieldGenerated.gt(new BN(0)) && vaultAccount.totalShares.gt(new BN(0))) {
    accIncrement = yieldGenerated.mul(SCALER).div(vaultAccount.totalShares);
  }
  const newAccPerShare = vaultAccount.accPerShare.add(accIncrement);

  // Update vault states using sync_vault_state instruction
  const newJupAllocation = vaultAccount.jupAllocation;
  const newKaminoAllocation = vaultAccount.kaminoAllocation;
  const newJupLendBalance = vaultAccount.jupLendBalance.sub(jupWithdrawUsdc);
  const newKaminoBalance = vaultAccount.kaminoBalance.sub(kaminoWithdrawUsdc);
  const newAccPerShareValue = newAccPerShare;
  const newTotalUnderlying = totalUnderlyingAfter;
  const newJupValue = vaultAccount.lastJupValue.sub(jupWithdrawUsdc);
  const newKaminoValue = vaultAccount.lastKaminoValue.sub(kaminoWithdrawUsdc);

  const syncTx = await program.methods
    .syncVaultState(
      newJupAllocation,
      newKaminoAllocation,
      newJupLendBalance,
      newKaminoBalance,
      newAccPerShareValue,
      newTotalUnderlying,
      newJupValue,
      newKaminoValue
    )
    .accounts({
      admin: accounts.admin.publicKey,
    })
    .signers([accounts.admin])
    .rpc();

  console.log("Vault state synced:", syncTx);

  // Transfer final USDC to user (simulate off-chain transfer)
  const vaultUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    accounts.vaultPda,
    true,
    TOKEN_PROGRAM_ID
  );
  const userUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    accounts.user.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );


  const userPositionSeeds = [Buffer.from("user_position"), accounts.user.publicKey.toBuffer()];
  const [userPositionAddress, _] = anchor.web3.PublicKey.findProgramAddressSync(userPositionSeeds, program.programId);
  
  const userPosition = await program.account.userPosition.fetch(userPositionAddress, "confirmed");

  const sharesToBurn = withdrawAmount.mul(vaultAccount.totalShares.div(vaultAccount.totalUnderlying));
  // Continue from here 
  
  // const pendingScaled = userPosition.

  console.log(
    `Transfer ${withdrawAmount.toString()} USDC from ${vaultUsdcAta.toBase58()} to ${userUsdcAta.toBase58()}`
  );

  // sync states for vault
  // sync states for user_position as well
  // we will have to write another instruction which will update the user_position states

  return {
    jupTx,
    kaminoTx,
    syncTx,
  };
}
