import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { YieldAggregator } from "../target/types/yield_aggregator";
import { getAccount } from "@solana/spl-token";
import { jupDeposit } from "./instructionCalls/jupDeposit";
import { kaminoDeposit } from "./instructionCalls/kaminoDeposit";
import { convertJupFTokenToUsdcAmount, convertKaminoTokenToUsdcAmount, getThresholdAmount } from "./helper-fns";
import { jupWithdraw } from "./instructionCalls/jupWithdraw";
import { kaminoWithdraw } from "./instructionCalls/kaminoWithdraw";


export async function invokeRebalance(
    program: anchor.Program<YieldAggregator>,
    provider: anchor.AnchorProvider,
    accounts : {
      admin : anchor.web3.Keypair,
      usdcMint : anchor.web3.PublicKey,
      jupFTokenMint: anchor.web3.PublicKey,
      vaultPda : anchor.web3.PublicKey,
      vaultUsdcAta : anchor.web3.PublicKey,
      vaultFTokenAta: anchor.web3.PublicKey,
      vaultKaminoTokenAta: anchor.web3.PublicKey,
    }
  ) {
  const previousVaultStates = await program.account.vault.fetch(
    accounts.vaultPda,
    "confirmed"
  );
  let vaultUsdcAtaDetails = await getAccount(provider.connection, accounts.vaultUsdcAta);
  let vaultJupAtaDetails = await getAccount(
    provider.connection,
    accounts.vaultFTokenAta
  );
  let vaultKaminoAtaDetails = await getAccount(
    provider.connection,
    accounts.vaultKaminoTokenAta
  );

  const vaultUsdcAtaBalance = new BN(vaultUsdcAtaDetails.amount);
  const vaultJupAtaBalance = new BN(vaultJupAtaDetails.amount);
  const vaultKaminoAtaBalance = new BN(vaultKaminoAtaDetails.amount);

  // check if this is the first time deposit by check both jup f-token and kamino token amount holdings == 0, if 0 allocate 50-50 to both platforms
  // first time allocation
  if (
    vaultJupAtaBalance.eq(new BN(0)) &&
    vaultKaminoAtaBalance.eq(new BN(0)) &&
    vaultUsdcAtaBalance.gt(new BN(0))
  ) {
    console.log("Running first time allocation...");
    // Save these in vault states
    const jupAllocation = new BN(5000);
    const kaminoAllocation = new BN(5000);

    let addHalf = vaultUsdcAtaBalance.mul(new BN(5000)).div(new BN(10000));
    console.log("Adding this amount to Jup and Kamino :", addHalf.toString());

    const jupTx = await jupDeposit(program, provider, addHalf, {
      admin : accounts.admin,
      usdcMint : accounts.usdcMint,
    });
    const kamTx = await kaminoDeposit(program, addHalf, { admin : accounts.admin, usdcMint: accounts.usdcMint });
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
        addHalf // new_kamino_value
      )
      .accounts({
        admin: accounts.admin.publicKey,
      })
      .signers([accounts.admin])
      .rpc();

    console.log(
      "Rebalance completed, vault state updated :",
      updateVaultStates
    );
  } else {
    // n-th time allocation
    // Check if we need rebalacing
    //  check percent increase in both platforms
    //  if they exceed some percent amount, we perform rebalance or else chill
    // if we need total rebalancing, write rebalance logic + add distrubution logic to rebalancing amount for stored USDC inside main_vault
    // if no rebalancing is required, add lazy distribution logic of USDC in main_vault_usdc_ata accoridng to allocation % (need to confirm if that doesnt interefere with our rebalance logic), will have to update last_jup_value, last_kamino_value according to how much we are pushing in each

    const lastJupValue = previousVaultStates.lastJupValue;
    const lastKaminoValue = previousVaultStates.lastKaminoValue;

    vaultJupAtaDetails = await getAccount(provider.connection, accounts.vaultFTokenAta); // Updating with the latest deposited amount
    vaultKaminoAtaDetails = await getAccount(
      provider.connection,
      accounts.vaultKaminoTokenAta
    );

    const oldJupUSDCValue = await convertJupFTokenToUsdcAmount(
      accounts.jupFTokenMint,
      new BN(vaultJupAtaDetails.amount),
      provider.connection
    );
    const oldKaminoUSDCValue = await convertKaminoTokenToUsdcAmount(
      new BN(vaultKaminoAtaDetails.amount),
      {
        usdcMint : accounts.usdcMint,
        admin: accounts.admin.publicKey,
        vaultPda: accounts.vaultPda,
      }
    );

    // calculate how much % increase is going on in either platform
    // we also have to check that the value is greater than 10000000
    const jupDiff = oldJupUSDCValue.sub(lastJupValue);
    let increaseInJup = new BN(0); // init variable 0% -> 157
    console.log(
      "Checking values :",
      jupDiff.toString(),
      oldJupUSDCValue.toString(),
      lastJupValue.toString()
    );
    if (!jupDiff.eq(new BN(0))) {
      increaseInJup = jupDiff.mul(new BN(10000)).div(lastJupValue);
      // if increaseInJup > 100 i.e. increaseInJup > 1 % and so on...
    }
    console.log(
      "Jup diff : ",
      oldJupUSDCValue.toString(),
      lastKaminoValue.toString(),
      jupDiff.toString()
    );
    console.log(
      "Jup percent value : ",
      increaseInJup.toString()
    );

    const kamDiff = oldKaminoUSDCValue.sub(lastKaminoValue);
    let increaseInKam = new BN(0); // init with 0 %
    if (!kamDiff.eq(new BN(0))) {
      increaseInKam = kamDiff.mul(new BN(10000)).div(lastKaminoValue);
    }
    console.log(
      "Kamino diff :",
      oldKaminoUSDCValue.toString(),
      lastKaminoValue.toString(),
      kamDiff.toString()
    );
    console.log(
      "Kamino percent value : ",
      increaseInKam.toString()
    );

    const getThresholdRequirement = getThresholdAmount({
      increaseInJupPercent: increaseInJup,
      increaseInKaminoPercent: increaseInKam,
    });

    // We are performing lazy balancing separately here to save transaction costs
    if (getThresholdRequirement.needsRebalance === true) {
      console.log("Threshold data : ", getThresholdRequirement);
      // add rebalancing logic here
      const newJupAllocation = getThresholdRequirement.JUP;
      const newKaminoAllocation = getThresholdRequirement.KAMINO;
      const SCALE = 10_000; // 100% = 10_000%

      // get current vaultJupAtaBalance and vaultKaminoAtaBalance
      vaultJupAtaDetails = await getAccount(
        provider.connection,
        accounts.vaultFTokenAta
      );
      vaultKaminoAtaDetails = await getAccount(
        provider.connection,
        accounts.vaultKaminoTokenAta
      );

      console.log(
        "Current jup vault amount : ",
        vaultJupAtaDetails.amount.toString()
      );
      // const existingUSDCValueInJupVault = await convertJupFTokenToUsdcAmount(accounts.jupFTokenMint, new BN(vaultJupAtaDetails.amount), connection);
      // console.log("Trying to withdraw from jup amount : ", existingUSDCValueInJupVault.toString());
      // get all funds from jup and kamino using jup_withdraw and kamino_withdraw
      await jupWithdraw(program, provider, new BN(vaultJupAtaDetails.amount), {
        admin : accounts.admin,
        usdcMint : accounts.usdcMint,
      });
      await kaminoWithdraw(program, new BN(vaultKaminoAtaDetails.amount), {
        admin: accounts.admin,
        usdcMint: accounts.usdcMint,
      });

      // Check if we have all the program vault
      let mainVaultUSDCAtaDetails = await getAccount(
        provider.connection,
        accounts.vaultUsdcAta,
        "confirmed"
      );
      const totalUnderlyingValue = new BN(mainVaultUSDCAtaDetails.amount);
      const totalCurrentValue = mainVaultUSDCAtaDetails.amount;
      console.log(
        "Main vault USDC amount  : ",
        mainVaultUSDCAtaDetails.amount.toString()
      );

      // multiply their value by allocation
      const newJupAllocatedValue = new BN(mainVaultUSDCAtaDetails.amount)
        .mul(new BN(newJupAllocation))
        .div(new BN(SCALE));
      const newKaminoAllocatedValue = new BN(mainVaultUSDCAtaDetails.amount)
        .mul(new BN(newKaminoAllocation))
        .div(new BN(SCALE));
      console.log(
        "Transfer balance before submission : ",
        newJupAllocatedValue.toString(),
        newKaminoAllocatedValue.toString()
      );
      // Dont have to lazy allocate because everything goes into the same vault whenever user deposits

      // use jup_deposit and kamino_deposit to allocate those funds
      await jupDeposit(program, provider, newJupAllocatedValue, {
        admin : accounts.admin,
        usdcMint : accounts.usdcMint,
      });
      await kaminoDeposit(program, newKaminoAllocatedValue, {
        admin : accounts.admin,
        usdcMint : accounts.usdcMint,
      });

      // Check if both jup and kamino ATA got their data and USDC is now empty
      mainVaultUSDCAtaDetails = await getAccount(
        provider.connection,
        accounts.vaultUsdcAta,
        "confirmed"
      );
      // console.log("Checking main vault USDC (SHOULD BE EMPTY)  : ", mainVaultUSDCAtaDetails.amount.toString());

      vaultJupAtaDetails = await getAccount(
        provider.connection,
        accounts.vaultFTokenAta
      );
      vaultKaminoAtaDetails = await getAccount(
        provider.connection,
        accounts.vaultKaminoTokenAta
      );
      console.log(
        "JUP Details should have half :",
        vaultJupAtaDetails.amount.toString()
      );
      console.log(
        "KAMINO Details should have half :",
        vaultKaminoAtaDetails.amount.toString()
      );

      const SCALER = new BN(1_000_000_000); // 1e9 for temporary fixed-point math
      const SCALE_DOWN = new BN(1_000_000); // reduce before writing to u64 on-chain

      // update states
      const newTotalUnderlying = totalUnderlyingValue;
      const totalPreviousValue = oldJupUSDCValue.add(oldKaminoUSDCValue);
      // const totalPreviousValue = new BN(96400000);
      const yieldGenerated = new BN(totalCurrentValue).sub(totalPreviousValue);
      let accIncrement = new BN(0);
      if (
        yieldGenerated.gt(new BN(0)) &&
        previousVaultStates.totalShares.gt(new BN(0))
      ) {
        // if (yieldGenerated.gt(new BN(0)) && new BN(96400000).gt(new BN(0))) {
        // Calculate acc_per_share increment:
        accIncrement = yieldGenerated
          .mul(SCALER)
          .div(new BN(previousVaultStates.totalShares));
        // accIncrement = yieldGenerated.mul(SCALER).div(new BN(96400000));
        console.log("AccIncrement : ", accIncrement.toString());
      }

      const accIncrementScaledDown = accIncrement.div(SCALE_DOWN);

      // const newAccPerShare = new BN(previousVaultStates.accPerShare).add(accIncrement);
      const newAccPerShare = new BN(previousVaultStates.accPerShare).add(
        accIncrementScaledDown
      );
      console.log("Checking new AccPerShare : ", newAccPerShare.toString());

      const updateVaultStatesTx = await program.methods
        .syncVaultState(
          newJupAllocation, // new_jup_allocation
          newKaminoAllocation, // new_kamino_allocation
          newJupAllocatedValue, // new_jup_lend_balance
          newKaminoAllocatedValue, // new_kamino_balance
          newAccPerShare, // new_acc_per_share
          newTotalUnderlying, // new_total_underlying
          newJupAllocatedValue, // new_jup_value
          newKaminoAllocatedValue // new_kamino_value
        )
        .accounts({
          admin: accounts.admin.publicKey,
        })
        .signers([accounts.admin])
        .rpc();

      console.log("Updated vault states : ", updateVaultStatesTx);
    } else {
      // Just perform lazy balancing

      const currentVault = await program.account.vault.fetch(accounts.vaultPda);
      // get vaultUsdcAta balance
      const vaultUsdcBalanceDetails = await getAccount(
        provider.connection,
        accounts.vaultUsdcAta
      );
      const balance = new BN(vaultUsdcBalanceDetails.amount);

      if (balance.eq(new BN(0))) {
        console.log("No idle USDC in vault. Skipping lazy balancing.");
        return;
      }

      // get current jup_allocation, kamino_allocation from vaultPda
      const jupAllocation = currentVault.jupAllocation;
      const kaminoAllocation = currentVault.kaminoAllocation;
      const SCALE = 10_000; // % value

      // calculate and split according to allocation for jup and kamino
      const jupAmount = balance.mul(new BN(jupAllocation)).div(new BN(SCALE));
      const kaminoAmount = balance
        .mul(new BN(kaminoAllocation))
        .div(new BN(SCALE));

      // call deposit jup and deposit kamino instructions here using jupDeposit and kaminoDeposit functions
      if (jupAmount.gt(new BN(0))) {
        await jupDeposit(program, provider, jupAmount, { admin : accounts.admin, usdcMint : accounts.usdcMint });
      }
      if (kaminoAmount.gt(new BN(0))) {
        await kaminoDeposit(program, kaminoAmount, { admin : accounts.admin, usdcMint : accounts.usdcMint });
      }
      // Update vault state for lazy balancing
      const newJupLendBalance = new BN(currentVault.jupLendBalance).add(
        jupAmount
      );
      const newKaminoBalance = new BN(currentVault.kaminoBalance).add(
        kaminoAmount
      );
      const newTotalUnderlying = new BN(currentVault.totalUnderlying).add(
        balance
      );

      const newJupValue = newJupLendBalance;
      const newKaminoValue = newKaminoBalance;

      const updateVaultStatesTx = await program.methods
        .syncVaultState(
          jupAllocation, // new_jup_allocation (unchanged)
          kaminoAllocation, // new_kamino_allocation (unchanged)
          newJupLendBalance, // new_jup_lend_balance
          newKaminoBalance, // new_kamino_balance
          currentVault.accPerShare, // new_acc_per_share (unchanged)
          newTotalUnderlying, // new_total_underlying
          newJupValue, // new_jup_value
          newKaminoValue // new_kamino_value
        )
        .accounts({
          admin: accounts.admin.publicKey,
        })
        .signers([accounts.admin])
        .rpc();

      console.log(
        "Lazy balancing completed, vault state updated:",
        updateVaultStatesTx
      );
    }
  }
}
