use anchor_lang::prelude::*;
use anchor_spl::{token::{transfer_checked, TransferChecked}, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::{UserPosition, Vault};
// use crate::jup_lend::{
//     accounts::TokenReserve,
    
//     cpi::{
//         self,
//         accounts::{Deposit as JupDeposit, Withdraw as JupWithdraw}
//     },
//     program::Lending
// };

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user : Signer<'info>,

    /// CHECK: admin details required to derive vault
    #[account(
        constraint = vault.authority.key() == admin.key()
    )]
    pub admin : AccountInfo<'info>,

    #[account(
        constraint = vault.usdc_mint.key() == usdc_mint.key(), 
        mint::token_program=token_program
    )]
    pub usdc_mint : InterfaceAccount<'info, Mint>,

    #[account(
        associated_token::mint=usdc_mint,
        associated_token::authority=user,
        associated_token::token_program=token_program
    )]
    pub user_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"vault", admin.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,   // Global vault

    #[account(
        constraint = vault.vault_usdc_ata.key() == vault_usdc_ata.key(),
        associated_token::mint=usdc_mint,
        associated_token::authority=vault,
        associated_token::token_program=token_program
    )]
    pub vault_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer=user,
        seeds = [b"user_position", user.key().as_ref()],
        space=8+UserPosition::INIT_SPACE,
        bump
    )]
    pub user_position : Account<'info, UserPosition>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,

}

impl<'info> Deposit<'info> {
    pub fn initialize_user_position(&mut self, deposited_amount : u64, user_position_bump: u8) -> Result<()>{
        let current_time = Clock::get().unwrap().unix_timestamp;

        
        let user_position_info = self.user_position.to_account_info();
        let existed = user_position_info.lamports() > 0 && user_position_info.data_len() > 0;

        if !existed {
            self.user_position.vault = self.vault.key();
            self.user_position.user = self.user.key();
            self.user_position.deposited_amount = deposited_amount;
            self.user_position.earned_yield = 0;
            self.user_position.last_updated = current_time;
            self.user_position.bump = user_position_bump;

        } else {
            self.user_position.deposited_amount += deposited_amount;
        }

        Ok(())
    }

    pub fn update_vault_state(&mut self, deposited_amount : u64) -> Result<()>{
        self.vault.total_deposits +=  deposited_amount;
        Ok(())
    }

    pub fn desposit_to_vault_ata(&mut self, deposited_amount : u64) -> Result<()>{

        // using base token program and not Token 2022
        let accounts = TransferChecked { 
            authority: self.user.to_account_info(),
            from: self.user_usdc_ata.to_account_info(),
            to: self.vault_usdc_ata.to_account_info(),
            mint: self.usdc_mint.to_account_info(),
        };
        let cpi_context = CpiContext::new(self.token_program.to_account_info(), accounts);

        transfer_checked(cpi_context, deposited_amount, self.usdc_mint.decimals)?;

        Ok(())
    }

    // TODO : create allocate_funds function which checks allocation_config and spreads the deposited_amount accordingly
}


pub fn handler(ctx : Context<Deposit>, deposited_amount : u64) -> Result<()>{
    // TODO: Perform proper error handling later
    ctx.accounts.initialize_user_position(deposited_amount, ctx.bumps.user_position)?;
    ctx.accounts.update_vault_state(deposited_amount)?;
    ctx.accounts.desposit_to_vault_ata(deposited_amount)?;
    Ok(())
}