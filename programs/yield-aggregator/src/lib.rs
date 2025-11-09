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

    pub fn deposit_kamino(ctx : Context<DepositKamino>, amount : u64) -> Result<()>{
        msg!("Running kamino handler");
        deposit_kamino::handler(ctx, amount)
        // Ok(())
    }

    pub fn rebalance(ctx: Context<Rebalance>) -> Result<()> {
        msg!("Running rebalance handler");
        rebalance::handler(ctx)
    }

    pub fn jup_deposit(ctx: Context<JupDeposit>, amount: u64) -> Result<()> {
        msg!("Running jup deposit handler");
        jup_deposit::handler(ctx, amount)
    }


}
