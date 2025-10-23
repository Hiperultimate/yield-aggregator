use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid allocation ratio provided.")]
    InvalidAllocation,
}
