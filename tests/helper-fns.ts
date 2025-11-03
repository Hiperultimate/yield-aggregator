import { web3 } from "@coral-xyz/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, type Mint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import axios from "axios";

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