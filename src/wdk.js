'use strict'

const bip39 = require('@scure/bip39')
const { wordlist } = require('@scure/bip39/wordlists/english.js')
const WalletManagerSolana = require('@tetherto/wdk-wallet-solana').default

const RPC = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:9'
const generateMnemonic = bip39.generateMnemonic || bip39.default?.generateMnemonic

function createSeedPhrase () {
  return generateMnemonic(wordlist, 128)
}

async function publicKeyFromSeed (seedPhrase) {
  const phrase = String(seedPhrase || '').trim().replace(/\s+/g, ' ')
  if (!phrase) throw Object.assign(new Error('seed phrase is required'), { code: 'ERR_INVALID_SEED' })
  const wallet = new WalletManagerSolana(phrase, { rpcUrl: RPC, commitment: 'confirmed' })
  const account = await wallet.getAccount(0)
  return await account.getAddress()
}

module.exports = { createSeedPhrase, publicKeyFromSeed }
