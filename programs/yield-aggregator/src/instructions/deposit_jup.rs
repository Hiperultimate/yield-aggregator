use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    account_info::AccountInfo
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use crate::error::ErrorCode;
use crate::jup_cpi;
use crate::jup_accounts;

#[error_code]
pub enum ErrorCodes {
    #[msg("CPI_TO_LENDING_PROGRAM_FAILED")]
    CpiToLendingProgramFailed,
}

#[derive(Accounts)]
pub struct DepositJup<'info> {
    /// signer (mutable, signer = true)
    #[account(mut)]
    pub signer: Signer<'info>,

    /// depositor_token_account (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub depositor_token_account: AccountInfo<'info>,

    /// recipient_token_account (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub recipient_token_account: AccountInfo<'info>,

    /// mint (read-only)
    /// CHECK: Validated by lending program
    pub mint: AccountInfo<'info>,

    /// lending_admin (read-only)
    /// CHECK: Validated by lending program
    pub lending_admin: AccountInfo<'info>,

    /// lending (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub lending: AccountInfo<'info>,

    /// f_token_mint (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub f_token_mint: AccountInfo<'info>,

    /// supply_token_reserves_liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub supply_token_reserves_liquidity: AccountInfo<'info>,

    /// lending_supply_position_on_liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub lending_supply_position_on_liquidity: AccountInfo<'info>,

    /// rate_model (read-only)
    /// CHECK: Validated by lending program
    pub rate_model: AccountInfo<'info>,

    /// vault (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub vault: AccountInfo<'info>,

    /// liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub liquidity: AccountInfo<'info>,

    /// liquidity_program (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub liquidity_program: AccountInfo<'info>,

    /// rewards_rate_model (read-only)
    /// /// CHECK: Validated by lending program
    pub rewards_rate_model: AccountInfo<'info>,

    /// CHECK: Validated by lending program
    pub lending_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}


impl<'info> DepositJup<'info> {
    pub fn deposit(&self, amount: u64) -> Result<()> {
        let jup_accounts = jup_accounts::Deposit{
            associated_token_program : self.associated_token_program.to_account_info(),
            depositor_token_account : self.depositor_token_account.to_account_info(),
            f_token_mint: self.f_token_mint.to_account_info(),
            lending: self.lending.to_account_info(),
            lending_admin: self.lending_admin.to_account_info() ,
            lending_supply_position_on_liquidity: self.lending_supply_position_on_liquidity.to_account_info() ,
            liquidity: self.liquidity.to_account_info() , 
            liquidity_program: self.liquidity_program.to_account_info() ,
            mint: self.mint.to_account_info() , 
            rate_model: self.rate_model.to_account_info() ,
            recipient_token_account: self.recipient_token_account.to_account_info() ,
            rewards_rate_model: self.rewards_rate_model.to_account_info() ,
            signer: self.signer.to_account_info() ,
            supply_token_reserves_liquidity: self.supply_token_reserves_liquidity.to_account_info() ,
            system_program: self.system_program.to_account_info() ,
            token_program: self.token_program.to_account_info() ,
            vault: self.vault.to_account_info() , 
        };
        let jup_cpi_program = self.lending_program.to_account_info();
        let jup_cpi_context = CpiContext::new(jup_cpi_program, jup_accounts);
        match jup_cpi::deposit(jup_cpi_context, amount){
            Ok(_) => Ok(()),
            Err(_) => Err(ErrorCode::CpiToLendingProgramFailed.into())
        }
    }
}

pub fn handler(ctx : Context<DepositJup> , amount : u64) -> Result<()>{
    msg!("Reaching here .......");
    ctx.accounts.deposit(amount)
    // Ok(())
}