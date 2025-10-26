pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
// pub mod jup_lend_interface;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("HCiHNgC88wQPNdUf6NfqC9ByXYQdFMQ8dW4BzMBHb39W");
declare_program!(jup_lend);

pub use jup_lend::{cpi as jup_cpi, cpi::accounts as jup_accounts, program::Lending as JupLendingProgram};

#[program]
pub mod yield_aggregator {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
