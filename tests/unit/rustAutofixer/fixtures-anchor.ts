// Fixtures for Anchor tier-1 visitors (attribute-only).
// Each pair: vulnerable + secure, framework: "anchor".

const ANCHOR_HEADER = `use anchor_lang::prelude::*;\n`;

// ---------- anchor-seeds-without-bump ----------
export const VULNERABLE_SEEDS_WITHOUT_BUMP = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32, seeds = [b"escrow"])]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_SEEDS_WITH_BUMP = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32, seeds = [b"escrow"], bump)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-init-without-space ----------
export const VULNERABLE_INIT_WITHOUT_SPACE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_INIT_WITH_SPACE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-init-without-payer ----------
export const VULNERABLE_INIT_WITHOUT_PAYER = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, space = 8 + 32)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_INIT_WITH_PAYER = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-realloc-incomplete ----------
export const VULNERABLE_REALLOC_INCOMPLETE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Grow<'info> {
  #[account(mut, realloc = 8 + 64)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_REALLOC_COMPLETE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Grow<'info> {
  #[account(mut, realloc = 8 + 64, realloc::payer = admin, realloc::zero = true)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-unchecked-account ----------
export const VULNERABLE_UNCHECKED_ACCOUNT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Use<'info> {
  /// CHECK: docs missing, validation missing
  pub mystery: UncheckedAccount<'info>,
  pub admin: Signer<'info>,
}
`;

export const SECURE_TYPED_ACCOUNT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Use<'info> {
  pub escrow: Account<'info, Escrow>,
  pub admin: Signer<'info>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;
