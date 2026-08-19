'use strict'

const fs = require('fs')
const path = require('path')
const Ajv = require('ajv')
const addFormats = require('ajv-formats')

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'schema', 'site-launch.json'), 'utf8')
)

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  allowUnionTypes: false
})
addFormats(ajv)

const validate = ajv.compile(schema)

const UNSUPPORTED_TEMPLATES = new Set(['full-site', 'mvp-site', 'dashboard-workbench'])

function pointerFromError (err) {
  if (err.instancePath) return err.instancePath
  if (err.params && err.params.additionalProperty) {
    const base = err.instancePath || ''
    return `${base}/${err.params.additionalProperty}`
  }
  return '/'
}

function validateSiteLaunch (body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: 'ERR_INVALID_JSON',
      message: 'Request body must be a JSON object',
      fields: [{ pointer: '/', message: 'Request body must be a JSON object' }]
    }
  }

  const templateName = body.spec && body.spec.template && body.spec.template.name
  if (typeof templateName === 'string' && UNSUPPORTED_TEMPLATES.has(templateName)) {
    return {
      ok: false,
      code: 'ERR_UNSUPPORTED_TEMPLATE',
      message: `Template ${templateName} is not available on 0.6-railway. Use minimal-site 0.6.0.`,
      fields: [{
        pointer: '/spec/template/name',
        message: `unsupported template: ${templateName}`
      }]
    }
  }

  if (!validate(body)) {
    const fields = (validate.errors || []).map((err) => ({
      pointer: pointerFromError(err),
      message: err.message
    }))
    return {
      ok: false,
      code: 'ERR_INVALID_SPEC',
      message: 'SiteLaunch document failed validation',
      fields
    }
  }

  return {
    ok: true,
    spec: {
      apiVersion: body.apiVersion,
      kind: body.kind,
      metadata: Number.isInteger(body.metadata.slot)
        ? { name: body.metadata.name, slot: body.metadata.slot }
        : { name: body.metadata.name },
      spec: {
        template: {
          name: body.spec.template.name,
          version: body.spec.template.version
        },
        persistence: body.spec.persistence,
        ...(body.spec.auth
          ? { auth: { username: body.spec.auth.username, password: body.spec.auth.password } }
          : {}),
        ...(Array.isArray(body.spec.plugins)
          ? { plugins: body.spec.plugins.slice() }
          : {})
      }
    }
  }
}

module.exports = { validateSiteLaunch }
