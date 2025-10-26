import { web3 } from "@coral-xyz/anchor";

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
