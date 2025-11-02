use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    account_info::AccountInfo
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Token, TransferChecked, transfer_checked};
use anchor_spl::token_interface::{Mint, TokenAccount};
use crate::error::ErrorCode;
use crate::{Vault, jup_cpi};
use crate::jup_accounts;
use crate::JupLendingProgram;


#[error_code]
pub enum ErrorCodes {
    #[msg("CPI_TO_LENDING_PROGRAM_FAILED")]
    CpiToLendingProgramFailed,
}

#[derive(Accounts)]
pub struct DepositJup<'info> {
    /// signer (mutable, signer = true)
    #[account(mut)]
    pub signer: Signer<'info>, // user

    /// CHECK: admin details required to derive vault
    #[account(
        constraint = main_vault.authority.key() == admin.key()
    )]
    pub admin : AccountInfo<'info>,

    /// mint (read-only)
    #[account(
        constraint = main_vault.usdc_mint.key() == mint.key(), 
        mint::token_program=token_program
    )]
    pub mint : InterfaceAccount<'info, Mint>,   // USDC Mint

    #[account(
        mut,
        // constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(), // We add this later
        associated_token::mint=mint,
        associated_token::authority=signer,
        associated_token::token_program=token_program
    )]
    pub signer_token_account : InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", admin.key().as_ref()],
        bump
    )]
    pub main_vault: Account<'info, Vault>,   // Global vault | Use this account to make the deposit

    #[account(
        mut,
        constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(),
        associated_token::mint=mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        // constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(), // We add this later
        associated_token::mint=f_token_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_f_token_ata : InterfaceAccount<'info, TokenAccount>,

    /// f_token_mint (mutable)
    #[account(
        mut,
        mint::token_program=token_program
    )]
    pub f_token_mint : InterfaceAccount<'info, Mint>,


    /// lending_admin (read-only)
    /// CHECK: Validated by lending program
    pub lending_admin: AccountInfo<'info>,

    /// lending (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub lending: AccountInfo<'info>,
    
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
    
    /// depositor_token_account (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub depositor_token_account: AccountInfo<'info>,

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
    pub lending_program: Program<'info, JupLendingProgram>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}


impl<'info> DepositJup<'info> {
    pub fn deposit(&self, amount: u64, main_vault_bump : u8) -> Result<()> {

        // deposit usdc to main_vault_usdc_ata from user account
        let accounts = TransferChecked { 
            authority: self.signer.to_account_info(),
            from: self.signer_token_account.to_account_info(),
            to: self.main_vault_usdc_ata.to_account_info(),
            mint: self.mint.to_account_info(),
        };
        let cpi_context = CpiContext::new(self.token_program.to_account_info(), accounts);

        transfer_checked(cpi_context, amount, self.mint.decimals)?;


        // transfer to jup
        let jup_accounts = jup_accounts::Deposit{
            signer: self.main_vault.to_account_info() ,
            depositor_token_account : self.main_vault_usdc_ata.to_account_info(),
            recipient_token_account: self.main_vault_f_token_ata.to_account_info(),

            associated_token_program : self.associated_token_program.to_account_info(),
            f_token_mint: self.f_token_mint.to_account_info(),
            lending: self.lending.to_account_info(),
            lending_admin: self.lending_admin.to_account_info() ,
            lending_supply_position_on_liquidity: self.lending_supply_position_on_liquidity.to_account_info() ,
            liquidity: self.liquidity.to_account_info() , 
            liquidity_program: self.liquidity_program.to_account_info() ,
            mint: self.mint.to_account_info() , 
            rate_model: self.rate_model.to_account_info() ,
            rewards_rate_model: self.rewards_rate_model.to_account_info() ,
            supply_token_reserves_liquidity: self.supply_token_reserves_liquidity.to_account_info() ,
            system_program: self.system_program.to_account_info() ,
            token_program: self.token_program.to_account_info() ,
            vault: self.vault.to_account_info() , 
        };

        let admin_key = self.admin.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", admin_key.as_ref(),&[main_vault_bump]]];

        let jup_cpi_program = self.lending_program.to_account_info();
        let jup_cpi_context = CpiContext::new_with_signer(jup_cpi_program, jup_accounts, signer_seeds);
        match jup_cpi::deposit(jup_cpi_context, amount){
            Ok(_) => Ok(()),
            Err(_) => Err(ErrorCode::CpiToLendingProgramFailed.into())
        }
    }
}

pub fn handler(ctx : Context<DepositJup> , amount : u64) -> Result<()>{
    msg!("Reaching here .......");
    ctx.accounts.deposit(amount, ctx.bumps.main_vault)
    // Ok(())
}