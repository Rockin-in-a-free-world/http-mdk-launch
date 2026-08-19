'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateNotes, MAX_NOTES_LENGTH } = require('../src/notes')

test('accepts a plain string', () => {
  const result = validateNotes('Ran it twice, second boot was clean.')
  assert.equal(result.ok, true)
  assert.equal(result.notes, 'Ran it twice, second boot was clean.')
})

test('accepts an empty string', () => {
  const result = validateNotes('')
  assert.equal(result.ok, true)
  assert.equal(result.notes, '')
})

test('rejects non-string notes', () => {
  const result = validateNotes(42)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ERR_INVALID_NOTES')
})

test('rejects missing notes', () => {
  const result = validateNotes(undefined)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ERR_INVALID_NOTES')
})

test('accepts notes right at the max length', () => {
  const notes = 'a'.repeat(MAX_NOTES_LENGTH)
  const result = validateNotes(notes)
  assert.equal(result.ok, true)
})

test('rejects notes over the max length', () => {
  const notes = 'a'.repeat(MAX_NOTES_LENGTH + 1)
  const result = validateNotes(notes)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ERR_NOTES_TOO_LONG')
})
