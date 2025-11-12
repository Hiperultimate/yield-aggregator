import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, type Mint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import axios from "axios";
import { getDepositReserveLiquidityAccounts, initRpc } from "./generate-kamino-accounts";
import { DEFAULT_RECENT_SLOT_DURATION_MS, KaminoMarket } from "@kamino-finance/klend-sdk";
import { Address } from "@solana/kit";
import Decimal from "decimal.js";
import { allocationDistributionChart } from "./constants";

export const confirmTx = async (
  signature: string,
  connection: web3.Connection
): Promise<string> => {
  const block = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    ...block,
  });
  return signature;
};

export const airdropTo = async (
  user: web3.PublicKey,
  amount: number,
  connection: web3.Connection
) : Promise<string> => {
  const tx = await connection.requestAirdrop(user, amount * web3.LAMPORTS_PER_SOL);
  return tx;
};

export async function convertUsdcToJupFTokenAmount(
  fTokenMint: web3.PublicKey,
  usdcAmount: anchor.BN, // in smallest units (e.g., 50 * 10^6 for 50 USDC)
  connection: web3.Connection
): Promise<anchor.BN> {
  const { getLendingTokenDetails } = await import("@jup-ag/lend/earn");

  const tokenDetails = await getLendingTokenDetails({ lendingToken: fTokenMint, connection });
  const scale = new anchor.BN(10).pow(new anchor.BN(tokenDetails.decimals));
  const fTokenAmount = usdcAmount.mul(tokenDetails.convertToShares).div(scale);

  return fTokenAmount;
}

/*
- convertToShares: A scaled BigNumber multiplier for converting underlying assets (e.g., USDC) 
  to shares (jlTokens/f-tokens). Calculated as (totalSupply * 10^decimals) / totalAssets,
  where decimals is the token's decimal places (typically 6). It ensures precise integer arithmetic for deposits.

- convertToAssets: A scaled BigNumber multiplier for converting shares (jlTokens/f-tokens) to underlying 
  assets (e.g., USDC). Calculated as (totalAssets * 10^decimals) / totalSupply. Used for withdrawals to get 
  exact asset amounts.
*/
export async function convertJupFTokenToUsdcAmount(
  fTokenMint: web3.PublicKey,
  fTokenAmount: anchor.BN, // in smallest units (e.g., 49057229 for ~49.057 USDC worth)
  connection: web3.Connection
): Promise<anchor.BN> {
  const { getLendingTokenDetails } = await import("@jup-ag/lend/earn");

  const tokenDetails = await getLendingTokenDetails({ lendingToken: fTokenMint, connection });

  const scale = new anchor.BN(10).pow(new anchor.BN(tokenDetails.decimals));
  const usdcAmount = fTokenAmount.mul(tokenDetails.convertToAssets).div(scale);
  
  return usdcAmount;
}

export async function convertKaminoTokenToUsdcAmount (convertAmount : anchor.BN, accounts : {usdcMint: anchor.web3.PublicKey, admin:anchor.web3.PublicKey, vaultPda: anchor.web3.PublicKey }) {
  const kaminoMainMarket = new anchor.web3.PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
  const rpc = initRpc('http://localhost:8899');
  const market = await KaminoMarket.load(rpc as any, kaminoMainMarket.toBase58() as Address, DEFAULT_RECENT_SLOT_DURATION_MS);
  const reserve = market.getReserveByMint(accounts.usdcMint.toBase58() as Address);

  const exchangeRate = reserve.getCollateralExchangeRate();
  const multiplier = new Decimal(10).pow(18)
  const exchangeRateNonDecimal = exchangeRate.mul(multiplier).floor();
  const exchangeRateBN = new anchor.BN(exchangeRateNonDecimal.toFixed(0));
  const kaminoTokenValueInUSDC = convertAmount.mul(new anchor.BN(10).pow(new anchor.BN(18))).div(exchangeRateBN);

  return kaminoTokenValueInUSDC;
}

export async function setUSDCViaCheatcode(
  receiverAddress: string,
  usdcAmount: number,
  usdcMintInfo : Mint,
  rpcUrl = "http://localhost:8899",
) {
  try {
    const owner = new web3.PublicKey(receiverAddress);
    const mint = new web3.PublicKey(usdcMintInfo.address);

    // compute Associated Token Account (ATA) for owner+mint
    const ata = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    // console.log("ATA computed:", ata.toBase58());

    // convert human USDC amount to smallest units
    const amountSmallest = Math.round(usdcAmount * Math.pow(10, usdcMintInfo.decimals));
    // console.log(`Minting ${usdcAmount} USDC = ${amountSmallest} smallest units`);

    // Build JSON-RPC payload for surfnet_setTokenAccount cheatcode.
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_setTokenAccount",
      params: [
        owner.toBase58(),
        mint.toBase58(),
        { amount: amountSmallest, state: "initialized" }
      ]
    };

    // console.log("Sending cheatcode RPC to", rpcUrl);
    const resp = await axios.post(rpcUrl, payload, { headers: { "Content-Type": "application/json" } });

    if (resp?.data?.error) {
      console.error("RPC returned error:", resp.data.error);
      throw new Error(JSON.stringify(resp.data.error));
    }

    // console.log("Cheatcode response:", JSON.stringify(resp.data.result || resp.data, null, 2));
    // console.log(`Successfully injected ${usdcAmount} USDC to ${owner.toBase58()} (ATA: ${ata.toBase58()})`);
    return { ata: ata.toBase58(), amountSmallest, rpcResult: resp.data.result || resp.data };
  } catch (err) {
    console.error("Failed to mint via cheatcode:", err?.response?.data || err.message || err);
    throw err;
  }
}


export function getThresholdAmount({
  increaseInJupPercent,
  increaseInKaminoPercent,
}: {
  increaseInJupPercent: BN,
  increaseInKaminoPercent: BN,
}){
  const thresholdDiff = BN.max(increaseInJupPercent, increaseInKaminoPercent).sub(BN.min(increaseInJupPercent, increaseInKaminoPercent)); // returns something like 060, 123, 302 => 0.6 %, 1.23 %, 3.02%
  
  const thresholdNums = Object.keys(allocationDistributionChart).map(i => Number(i)).sort((a,b) => b-a);
  const minThresholdRequirement = Math.min(...thresholdNums);
  // if thresholdDiff is > minThreshold requirement we need to rebalance
  let selectedAllocation : [number,number] | null;
  if(thresholdDiff.lt(new BN(minThresholdRequirement))){ // checking difference is at least greater than min threshold mentioned
    return { needsRebalance : false }
  }

  // Getting the threshold we need to use
  for(let threshold of thresholdNums){
    const thresholdBn = new BN(threshold);
    if(thresholdDiff.gte(thresholdBn)){
      selectedAllocation = allocationDistributionChart[threshold];
      break;
    }
  }

  if(!selectedAllocation){ throw new Error("Something went wrong while selecting threshold")};

  const isJupOutperforming = increaseInJupPercent.gt(increaseInKaminoPercent);
  return {
    needsRebalance : true,
    JUP: isJupOutperforming ? selectedAllocation[0] : selectedAllocation[1],
    KAMINO: isJupOutperforming ? selectedAllocation[1] : selectedAllocation[0],
  };
}