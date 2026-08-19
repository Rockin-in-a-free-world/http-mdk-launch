'use strict'

const MAX_NOTES_LENGTH = 4000

function validateNotes (notes) {
  if (typeof notes !== 'string') {
    return {
      ok: false,
      code: 'ERR_INVALID_NOTES',
      message: 'notes must be a string'
    }
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    return {
      ok: false,
      code: 'ERR_NOTES_TOO_LONG',
      message: `notes must be ${MAX_NOTES_LENGTH} characters or fewer`
    }
  }
  return { ok: true, notes }
}

module.exports = { validateNotes, MAX_NOTES_LENGTH }
