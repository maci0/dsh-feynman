/**
 * Real-composition test: the plugin mounts into a real `@deepseek-ai/cordis`
 * `Context` and releases every registration when its fiber disposes.
 *
 * The other suites drive plain-object fakes, which cannot show whether a
 * registration is released, and a live profile reloads plugin rows on every
 * edit — a leaked registration would double up on the next reload.
 *
 * @module dsh-feynman/composition
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { Context, Service } from '@deepseek-ai/cordis'

import { apply } from './index.js'

/** The command seam, tied to the consumer's context the way the registry is. */
class CommandsSeam extends Service {
  registered = new Map()

  constructor(ctx) {
    super(ctx, 'commands')
  }

  register(definition) {
    return this.ctx.effect(() => {
      this.registered.set(definition.name, definition)
      return () => { this.registered.delete(definition.name) }
    })
  }
}

/** The agent lookup a plugin reaches on `turn/end`. */
class AgentsSeam extends Service {
  agents = new Map()

  constructor(ctx) {
    super(ctx, 'agents')
  }

  get(sessionId) {
    return this.agents.get(sessionId)
  }
}

test('the plugin mounts into a real Cordis context and releases what it registered', async () => {
  const ctx = new Context()
  const commands = new CommandsSeam(ctx)
  const agents = new AgentsSeam(ctx)

  const fiber = await ctx.plugin({ name: 'feynman', inject: ['commands', 'agents'], apply }, undefined)
  assert.deepEqual([...commands.registered.keys()], ['feynman'])

  await fiber.dispose()
  assert.deepEqual([...commands.registered.keys()], [], 'the command is released with the fiber')
})
