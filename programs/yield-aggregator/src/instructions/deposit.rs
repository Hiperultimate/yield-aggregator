    use anchor_lang::prelude::*;
use std::ops::{Div, Mul};
use anchor_lang::solana_program::{
    account_info::AccountInfo
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Token, TransferChecked, transfer_checked};
use anchor_spl::token_interface::{Mint, TokenAccount};
use crate::error::ErrorCode;
use crate::{AllocationConfig, AllocationMode, Lending as JupLending, UserPosition, Vault, jup_cpi};
use crate::jup_accounts;
use crate::JupLendingProgram;


#[derive(Accounts)]
pub struct Deposit<'info> {
    /// signer (mutable, signer = true)
    #[account(mut)]
    pub user: Signer<'info>, // user

    /// CHECK: admin details required to derive vault
    #[account(
        constraint = main_vault.authority.key() == admin.key()
    )]
    pub admin : AccountInfo<'info>,

    /// mint (read-only)
    #[account(
        constraint = main_vault.usdc_mint.key() == usdc_mint.key(), 
        mint::token_program=token_program
    )]
    pub usdc_mint : InterfaceAccount<'info, Mint>,   // USDC Mint

    #[account(
        mut,
        // constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(), // We add this later
        associated_token::mint=usdc_mint,
        associated_token::authority=user,
        associated_token::token_program=token_program
    )]
    pub user_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", admin.key().as_ref()],
        bump
    )]
    pub main_vault: Box<Account<'info, Vault>>,   // Global vault | Use this account to make the deposit

    #[account(
        // add a constriant to confirm which admin yield instruction it belongs it
        seeds=[b"allocation_config", admin.key().as_ref() ],
        bump
    )]
    pub vault_allocation_config : Box<Account<'info, AllocationConfig>>,

    #[account(
        mut,
        constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(),
        associated_token::mint=usdc_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer=user,
        seeds = [b"user_position", user.key().as_ref()],
        space=8+UserPosition::INIT_SPACE,
        bump
    )]
    pub user_position : Box<Account<'info, UserPosition>>,

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


impl<'info> Deposit<'info> {
    pub fn initialize_user_position(&mut self, deposited_amount : u64, user_position_bump: u8) -> Result<()>{
        let current_time = Clock::get().unwrap().unix_timestamp;

        let user_position_info = self.user_position.to_account_info();
        let existed = user_position_info.lamports() > 0 && user_position_info.data_len() > 0;

        if !existed {
            self.user_position.vault = self.main_vault.key();
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
        self.main_vault.total_deposits +=  deposited_amount;
        Ok(())
    }

    pub fn desposit_to_vault_ata(&mut self, deposited_amount : u64) -> Result<()>{
        // deposit usdc to main_vault_usdc_ata from user account
        let accounts = TransferChecked { 
            authority: self.user.to_account_info(),
            from: self.user_usdc_ata.to_account_info(),
            to: self.main_vault_usdc_ata.to_account_info(),
            mint: self.usdc_mint.to_account_info(),
        };
        let cpi_context = CpiContext::new(self.token_program.to_account_info(), accounts);

        transfer_checked(cpi_context, deposited_amount, self.usdc_mint.decimals)
    }

    pub fn jup_deposit(&mut self, deposited_amount : u64) -> Result<()> {
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
            mint: self.usdc_mint.to_account_info() , 
            rate_model: self.rate_model.to_account_info() ,
            rewards_rate_model: self.rewards_rate_model.to_account_info() ,
            supply_token_reserves_liquidity: self.supply_token_reserves_liquidity.to_account_info() ,
            system_program: self.system_program.to_account_info() ,
            token_program: self.token_program.to_account_info() ,
            vault: self.vault.to_account_info() , 
        };

        let admin_key = self.admin.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", admin_key.as_ref(),&[self.main_vault.bump]]];

        let jup_cpi_program = self.lending_program.to_account_info();
        let jup_cpi_context = CpiContext::new_with_signer(jup_cpi_program, jup_accounts, signer_seeds);
        match jup_cpi::deposit(jup_cpi_context, deposited_amount){
            Ok(_) => Ok(()),
            Err(_) => Err(ErrorCode::CpiToLendingProgramFailed.into())
        }
    }

    // TODO : create allocate_funds function which checks allocation_config and spreads the deposited_amount accordingly
    pub fn allocate_funds(&mut self, deposited_amount : u64) -> Result<()>{
        // Check the mode
        let config_mode = self.vault_allocation_config.mode.clone();

        // fetch current price of the spent USDC

        // Current price held in jup
        let vault_f_token_balance = self.main_vault_f_token_ata.amount;
        let lending_data = JupLending::try_deserialize(&mut &self.lending.data.borrow()[..])?;
        let token_exchange_price = lending_data.token_exchange_price;   // it could be that lending is not initialized yet if this is the first deposit, need to check
        let jup_usdc_value = vault_f_token_balance.mul(token_exchange_price).div(10_u64.pow(self.usdc_mint.decimals as u32) );

        // Current price held in kamino
        let kamino_usdc_value: u64 = 0;  // dummy value for now

        match config_mode {
            AllocationMode::Static => {
                // manual balancing

                // calculate the spread, how much amount needs to go in Jup and kamino
                // but allocation can change overtime, so users money will not be spread evenly
                let a_j = jup_usdc_value; // current price in Jup
                let a_k = kamino_usdc_value; // current price in Kamino
                let t = a_j + a_k;  // total price invested

                let r_j = self.vault_allocation_config.jup_allocation as u64; // jup ratio
                let r_k = self.vault_allocation_config.kamino_allocation as u64; // kamino ratio
                let d = deposited_amount;   // new deposit amount

                let t_n = t + d;    // new total
                let a_nj = r_j.mul(t_n);
                let a_nk = r_k.mul(t_n);
                let mut addj = a_nj - a_j;
                let mut addk = a_nk - a_k;

                // Handle impossible / out of bound scenarios
                if addj < 0 {
                    addj = 0;
                    addk = d;
                }
                // Kamino is overweight, cannot withraw -> deposit everything in Jup
                else if addk < 0 {
                    addj = d;
                    addk = 0;
                }
                else {
                    // both positive - normal case
                    if addj + addk > d {
                            // normalize proportionally
                            let scale = d / (addj + addk);
                            addj = addj * scale;
                            addk = addk * scale;
                        }
                }

                // Write logic to transfer addj to jup
                msg!("addj : {}, addk : {}", addj, addk);
                if addj > 0 {
                    msg!("Depositing {} to JUP LEND", addj);
                    self.jup_deposit(addj)?;
                }
                
                // Write logic to transfer addk to kamino
            },
            AllocationMode::Dynamic => {
                // auto balancing
            }
        }
        
        Ok(())
    }

}

pub fn handler(ctx : Context<Deposit> , amount : u64) -> Result<()>{
    msg!("Reaching here .......");
    ctx.accounts.initialize_user_position(amount, ctx.bumps.user_position)?;
    ctx.accounts.update_vault_state(amount)?;
    ctx.accounts.desposit_to_vault_ata(amount)?;
    ctx.accounts.allocate_funds(amount)?;
    Ok(())
}