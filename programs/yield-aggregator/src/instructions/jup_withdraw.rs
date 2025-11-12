use anchor_lang::{prelude::*, solana_program::{instruction::Instruction, program::invoke_signed}};
use anchor_spl::{associated_token::AssociatedToken, token::Token, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::error::ErrorCode;
use crate::{Vault, jup_cpi};
use crate::jup_accounts;
use crate::JupLendingProgram;

#[derive(Accounts)]
pub struct JupWithdraw<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", admin.key().as_ref()],
        bump
    )]
    pub main_vault: Account<'info, Vault>,

    #[account(
        mut,
        constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(),
        associated_token::mint=usdc_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = main_vault.usdc_mint.key() == usdc_mint.key(), 
        mint::token_program=token_program
    )]
    pub usdc_mint : InterfaceAccount<'info, Mint>,

    /// Jup related accounts
    #[account(
        mut,
        associated_token::mint=f_token_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_f_token_ata : InterfaceAccount<'info, TokenAccount>,

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

    #[account(mut)]
    /// CHECK: Validated by lending program
    pub claim_account: AccountInfo<'info>,
    
    /// liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub liquidity: AccountInfo<'info>,

    /// liquidity_program (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub liquidity_program: AccountInfo<'info>,

    /// rewards_rate_model (read-only)
    /// CHECK: Validated by lending program
    pub rewards_rate_model: AccountInfo<'info>,

    /// CHECK: Validated by lending program
    pub lending_program: Program<'info, JupLendingProgram>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> JupWithdraw<'info> {
    pub fn jup_withdraw(&mut self, withdraw_amount : u64) -> Result<()> {
        msg!("Withdrawing funds from JUP");
        // withdraw(amount) = you tell it how many assets (e.g. USDC) you want back.
        // redeem(shares) = you tell it how many f-tokens (shares) you want to burn.
        let jup_accounts = jup_accounts::Redeem{
            signer: self.main_vault.to_account_info() ,
            owner_token_account: self.main_vault_f_token_ata.to_account_info(),
            recipient_token_account: self.main_vault_usdc_ata.to_account_info(),

            f_token_mint: self.f_token_mint.to_account_info(),
            lending: self.lending.to_account_info(),
            lending_admin: self.lending_admin.to_account_info() ,
            lending_supply_position_on_liquidity: self.lending_supply_position_on_liquidity.to_account_info() ,
            liquidity: self.liquidity.to_account_info() , 
            liquidity_program: self.liquidity_program.to_account_info() ,
            mint: self.usdc_mint.to_account_info() , 
            rate_model: self.rate_model.to_account_info() ,
            rewards_rate_model: self.rewards_rate_model.to_account_info() ,
            supply_token_reserves_liquidity: self.supply_token_reserves_liquidity.to_account_info() ,
            vault: self.vault.to_account_info() , 
            claim_account : self.claim_account.to_account_info(),
            associated_token_program : self.associated_token_program.to_account_info(),
            token_program: self.token_program.to_account_info() ,
            system_program: self.system_program.to_account_info() ,
        };

        let admin_key = self.admin.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", admin_key.as_ref(),&[self.main_vault.bump]]];


        let jup_cpi_program = self.lending_program.to_account_info();
        let jup_cpi_context = CpiContext::new_with_signer(jup_cpi_program, jup_accounts, signer_seeds);
        match jup_cpi::redeem(jup_cpi_context, withdraw_amount){
            Ok(_) => Ok(()),
            Err(_) => Err(ErrorCode::CpiToLendingProgramFailed.into())
        }
    }
}

pub fn handler(ctx: Context<JupWithdraw>, amount: u64) -> Result<()> {
    ctx.accounts.jup_withdraw(amount)?;
    Ok(())
}