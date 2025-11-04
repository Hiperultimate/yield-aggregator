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

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn initialize_vault(ctx: Context<InitializeVault>, jup_allocation: u16, kamino_allocation: u16) -> Result<()> {
        initialize_vault::handler(ctx, jup_allocation, kamino_allocation)
    }

    pub fn deposit(ctx : Context<Deposit>, amount : u64) -> Result<()>{
        msg!("Running jup handler");
        deposit::handler(ctx, amount)
        // Ok(())
    }
}
