import {
    McpServer,
    ResourceTemplate,
  } from "@modelcontextprotocol/sdk/server/mcp.js";
  import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
  import { z } from "zod";
  import { BN } from "@project-serum/anchor";
  
  import {
    Connection,
    PublicKey,
    LAMPORTS_PER_SOL,
    clusterApiUrl,
    Transaction,
    TransactionInstruction,
    Keypair,
  } from "@solana/web3.js";
  import * as fs from "fs";
  import * as anchor from "@project-serum/anchor";
  import { Program } from "@project-serum/anchor";
  import { bs58, utf8 } from "@project-serum/anchor/dist/cjs/utils/bytes";
  import { BorshAccountsCoder } from "@project-serum/anchor";

  
function mapAnchorTypeToRust(anchorType: any): string {
    const typeStr = anchorType.toString().toLowerCase();
    
    if (typeStr.includes('u8')) return 'u8';
    if (typeStr.includes('u16')) return 'u16';
    if (typeStr.includes('u32')) return 'u32';
    if (typeStr.includes('u64')) return 'u64';
    if (typeStr.includes('i8')) return 'i8';
    if (typeStr.includes('i16')) return 'i16';
    if (typeStr.includes('i32')) return 'i32';
    if (typeStr.includes('i64')) return 'i64';
    if (typeStr.includes('bool')) return 'bool';
    if (typeStr.includes('string')) return 'String';
    if (typeStr.includes('pubkey')) return '&Pubkey';
    
    if (typeStr.includes('vec<') || typeStr.includes('[]')) {
      let innerType;
      if (typeStr.includes('vec<')) {
        innerType = typeStr.substring(typeStr.indexOf('<') + 1, typeStr.lastIndexOf('>'));
      } else {
        innerType = typeStr.substring(0, typeStr.indexOf('['));
      }
      
      return `Vec<${mapAnchorTypeToRust(innerType)}>`;
    }
    
    return 'Box<dyn std::any::Any>'; // Fallback for complex types
  }
  
  export const createCPI = async (programId: string, instructionName: string) => {
    
      try {
        // Validate program ID
        try {
          new PublicKey(programId);
        } catch (error) {
          return {
            error: `Invalid program ID: ${(error as Error).message}`
          };
        }
         
        
        
        // console.log(`Generating CPI example for program ${programId}, instruction ${instructionName}`);
        
        // Try to fetch IDL from different clusters
        let idl = null;
        let fetchedCluster = null;
        
        for (const cluster of ["mainnet-beta", "devnet", "testnet"]) {
          try {
            const connection = new Connection(clusterApiUrl(cluster as any), "confirmed");
            
            // Create a dummy provider since we're just reading data
            const provider = new anchor.AnchorProvider(
              connection,
              {
                publicKey: Keypair.generate().publicKey,
                signTransaction: async (tx) => tx,
                signAllTransactions: async (txs) => txs,
              },
              { commitment: "confirmed" }
            );
            
            // Try to fetch IDL from on-chain program account
            const fetchedIdl = await anchor.Program.fetchIdl(new PublicKey(programId), provider);
            
            if (fetchedIdl) {
              console.log(`Found IDL on ${cluster}`);
              idl = fetchedIdl;
              fetchedCluster = cluster;
              break;
            }
          } catch (error) {
            // console.log(`Could not fetch IDL from ${cluster}:`, (error as Error).message);
          }
        }
        
        if (!idl) {
          return {
            error: `No IDL found for program ${programId} on any cluster. The program might not be an Anchor program or the IDL might not be uploaded on-chain.`
          };
        }
        
        // Find the instruction in the IDL
        const instruction = idl.instructions.find(ins => ins.name === instructionName);
        
        if (!instruction) {
          return {
            error: `Instruction '${instructionName}' not found in the program's IDL.`
          };
        }
        
        // Generate account variable declarations
        const accountsCode = instruction.accounts.map((account, idx) => {
          const accountName = account.name.charAt(0).toLowerCase() + account.name.slice(1);
          let comment = [];
          if ('isMut' in account && account.isMut) comment.push("mutable");
          if ('isSigner' in account && account.isSigner) comment.push("signer");
          if (comment.length === 0) comment.push("readonly");
          
          return `    let ${accountName}_info = next_account_info(account_info_iter)?; // ${comment.join(", ")}`;
        }).join('\n');
      
        // Generate data serialization based on args
        let argsDeclaration = '';
        let argsStructFields = '';
        let argsStructName = '';
        
        if (instruction.args && instruction.args.length > 0) {
          // Create a struct to hold the instruction arguments
          argsStructName = `${instructionName.charAt(0).toUpperCase() + instructionName.slice(1)}Args`;
          
          // Add args to function declaration
          argsDeclaration = instruction.args.map(arg => {
            const rustType = mapAnchorTypeToRust(arg.type);
            return `    ${arg.name}: ${rustType},`;
          }).join('\n');
          
          // Create struct fields
          argsStructFields = instruction.args.map(arg => {
            const rustType = mapAnchorTypeToRust(arg.type);
            return `    pub ${arg.name}: ${rustType},`;
          }).join('\n');
        }
      
        // Generate account metas
        const accountMetasCode = instruction.accounts.map(account => {
          const accountName = account.name.charAt(0).toLowerCase() + account.name.slice(1);
          if ((account as any).isMut && (account as any).isSigner) {
            return `        AccountMeta::new(*${accountName}_info.key, true),`;
          } else if ((account as any).isMut) {
            return `        AccountMeta::new(*${accountName}_info.key, false),`;
          } else if ((account as any).isSigner) {
            return `        AccountMeta::new_readonly(*${accountName}_info.key, true),`;
          } else {
            return `        AccountMeta::new_readonly(*${accountName}_info.key, false),`;
          }
        }).join('\n');
      
        // Determine if we need invoke or invoke_signed
        const needsSign = instruction.accounts.some(account => (account as any).isSigner);
        
        // Imports block
        const importsBlock = `use anchor_lang::prelude::*;
  use anchor_lang::solana_program::{
      account_info::{next_account_info, AccountInfo},
      entrypoint::ProgramResult,
      instruction::{AccountMeta, Instruction},
      program::{invoke, invoke_signed},
      program_error::ProgramError,
      pubkey::Pubkey,
  };
  `;
      
        // Create the args struct if needed
        let argsStruct = '';
        if (instruction.args && instruction.args.length > 0) {
          argsStruct = `
  // Args struct for ${instructionName} instruction
  #[derive(AnchorSerialize)]
  pub struct ${argsStructName} {
  ${argsStructFields}
  }
  `;
        }
      
        // Create the CPI example
        let cpiFunction;
        if (needsSign) {
          cpiFunction = `
  // Cross-Program Invocation (CPI) to ${programId} for instruction '${instructionName}'
  pub fn make_${instructionName.toLowerCase()}_cpi<'a>(
      accounts: &'a [AccountInfo<'a>],
  ${argsDeclaration}
      seeds: &[&[&[u8]]],  // Seeds for PDAs that need to sign the transaction
  ) -> ProgramResult {
      // Get account iterator
      let account_info_iter = &mut accounts.iter();
  
      // Extract account infos
  ${accountsCode}
  
      // Program ID for the target program (${programId})
      let program_id = Pubkey::new_from_array([${new PublicKey(programId).toBuffer().join(', ')}]);
      
      // Create instruction data
      let mut instruction_data = vec![];
  ${instruction.args && instruction.args.length > 0 ? 
          `
      // Create and serialize the args struct
      let args = ${argsStructName} {
  ${instruction.args.map(arg => `        ${arg.name},`).join('\n')}
      };
      
      // Add instruction discriminator (8 bytes) and serialized args
      let mut anchor_data = anchor_lang::AnchorSerialize::try_to_vec(&args)
          .map_err(|_| ProgramError::InvalidInstructionData)?;
      
      instruction_data.extend_from_slice(&anchor_lang::solana_program::hash::hash("global:${instructionName}".as_bytes()).to_bytes()[0..8]);
      instruction_data.append(&mut anchor_data);` : 
          `
      // Add instruction discriminator (8 bytes) - no args for this instruction
      instruction_data.extend_from_slice(&anchor_lang::solana_program::hash::hash("global:${instructionName}".as_bytes()).to_bytes()[0..8]);`}
  
      // Create the instruction
      let instruction = Instruction {
          program_id,
          accounts: vec![
  ${accountMetasCode}
          ],
          data: instruction_data,
      };
  
      // Execute CPI with signer privileges
      invoke_signed(
          &instruction,
          accounts,
          seeds,
      )
  }`;
        } else {
          cpiFunction = `
  // Cross-Program Invocation (CPI) to ${programId} for instruction '${instructionName}'
  pub fn make_${instructionName.toLowerCase()}_cpi<'a>(
      accounts: &'a [AccountInfo<'a>],
  ${argsDeclaration}
  ) -> ProgramResult {
      // Get account iterator
      let account_info_iter = &mut accounts.iter();
  
      // Extract account infos
  ${accountsCode}
  
      // Program ID for the target program (${programId})
      let program_id = Pubkey::new_from_array([${new PublicKey(programId).toBuffer().join(', ')}]);
      
      // Create instruction data
      let mut instruction_data = vec![];
  ${instruction.args && instruction.args.length > 0 ? 
          `
      // Create and serialize the args struct
      let args = ${argsStructName} {
  ${instruction.args.map(arg => `        ${arg.name},`).join('\n')}
      };
      
      // Add instruction discriminator (8 bytes) and serialized args
      let mut anchor_data = anchor_lang::AnchorSerialize::try_to_vec(&args)
          .map_err(|_| ProgramError::InvalidInstructionData)?;
      
      instruction_data.extend_from_slice(&anchor_lang::solana_program::hash::hash("global:${instructionName}".as_bytes()).to_bytes()[0..8]);
      instruction_data.append(&mut anchor_data);` : 
          `
      // Add instruction discriminator (8 bytes) - no args for this instruction
      instruction_data.extend_from_slice(&anchor_lang::solana_program::hash::hash("global:${instructionName}".as_bytes()).to_bytes()[0..8]);`}
  
      // Create the instruction
      let instruction = Instruction {
          program_id,
          accounts: vec![
  ${accountMetasCode}
          ],
          data: instruction_data,
      };
  
      // Execute CPI
      invoke(
          &instruction,
          accounts,
      )
  }`;
        }
      
        // Full example combining everything
        const fullExample = `${importsBlock}
  ${argsStruct}
  ${cpiFunction}
  
  /*
   * Usage example in another program:
   */
  pub fn process_instruction(
      program_id: &Pubkey,
      accounts: &[AccountInfo],
      instruction_data: &[u8],
  ) -> ProgramResult {
      // ... your program logic ...
      
      // Make the CPI to ${instructionName}
      make_${instructionName.toLowerCase()}_cpi(
          accounts,
          ${instruction.args && instruction.args.length > 0 
            ? instruction.args.map(arg => {
                if (arg.type.toString().toLowerCase().includes('pubkey')) {
                  return '&Pubkey::new_unique()';
                } else if (arg.type.toString().toLowerCase().includes('u64')) {
                  return '1000';
                } else if (arg.type.toString().toLowerCase().includes('u8')) {
                  return '42';
                } else if (arg.type.toString().toLowerCase().includes('bool')) {
                  return 'true';
                } else if (arg.type.toString().toLowerCase().includes('string')) {
                  return '"example".to_string()';
                } else {
                  return '/* value for ' + arg.name + ' */';
                }
              }).join(', ')
            : ''
          }${needsSign ? ',\n        &[&[&[/* your seeds here */]]]' : ''}
      )?;
      
      Ok(())
  }`;
  
        console.log(`Successfully generated CPI example`);
        return {
          cpiExample: fullExample,
          programIdl: idl,
          cluster: fetchedCluster
        };
      } catch (error) {
        console.error(`Unexpected error:`, error);
        return {
          error: `Error generating CPI example: ${(error as Error).message}`
        };
      }

}