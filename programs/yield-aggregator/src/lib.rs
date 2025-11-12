pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
// pub mod jup_lend_interface;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2U9Kgnfy18YuHoNwuMiLsjJgmaHGCV55RK1MaxZ1TzZe");
declare_program!(jup_lend);

pub use jup_lend::{cpi as jup_cpi, cpi::accounts as jup_accounts, program::Lending as JupLendingProgram};

#[program]
pub mod yield_aggregator {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        initialize_vault::handler(ctx)
    }

    pub fn deposit(ctx : Context<Deposit>, amount : u64) -> Result<()>{
        msg!("Running deposit handler");
        deposit::handler(ctx, amount)
    }

    pub fn kamino_deposit(ctx : Context<KaminoDeposit>, amount : u64) -> Result<()>{
        msg!("Running kamino handler");
        kamino_deposit::handler(ctx, amount)
        // Ok(())
    }

    pub fn kamino_withdraw(ctx : Context<KaminoWithdraw>, amount : u64) -> Result<()>{
        msg!("Running kamino withdraw handler");
        kamino_withdraw::handler(ctx, amount)
    }

    pub fn sync_vault_state(
        ctx: Context<SyncVaultState>,
        new_jup_allocation : u16,
        new_kamino_allocation : u16,
        new_jup_lend_balance : u64,
        new_kamino_balance : u64,
        new_acc_per_share: u64,
        new_total_underlying: u64,
        new_jup_value: u64,
        new_kamino_value: u64,
    ) -> Result<()> {
        sync_vault_state::handler(ctx, 
            new_jup_allocation,
            new_kamino_allocation,
            new_jup_lend_balance,
            new_kamino_balance,
            new_acc_per_share,
            new_total_underlying,
            new_jup_value,
            new_kamino_value,
        )
    }

    pub fn jup_deposit(ctx: Context<JupDeposit>, amount: u64) -> Result<()> {
        msg!("Running jup deposit handler");
        jup_deposit::handler(ctx, amount)
    }

    pub fn jup_withdraw(ctx: Context<JupWithdraw>, amount: u64) -> Result<()> {
        msg!("Running jup withdraw handler");
        jup_withdraw::handler(ctx, amount)
    }


}
