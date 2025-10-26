import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { YieldAggregator } from "../target/types/yield_aggregator";
import JupLendIDL from "../idls/jup_lend.json";
import { JupLendIDLType } from "./jupLend";
import {
  createMint,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  mintTo,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { airdropTo, confirmTx } from "./helper-fns";
import { assert } from "chai";

describe("yield-aggregator", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.yieldAggregator as Program<YieldAggregator>;
  const jupLendProgram = new Program(
    JupLendIDL,
    provider
  ) as Program<JupLendIDLType>;

  let admin: anchor.web3.Keypair;
  let usdcMint: anchor.web3.PublicKey;
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

    usdcMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

    // This may be un-required later on
    jupFTokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );
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
    await mintTo(
      provider.connection,
      admin,
      usdcMint,
      userUsdcAta,
      admin,
      1_000_000_000
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

  it("User deposits USDC to vault", async () => {});
});
