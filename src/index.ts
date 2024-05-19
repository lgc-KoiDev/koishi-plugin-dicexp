import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { Context, Schema } from 'koishi'
import Worker from 'web-worker'

import I18nEnUS from './locales/en-US.yml'
import I18nZhCN from './locales/zh-CN.yml'

import type { EvaluationResult } from '@dicexp/interface'

// if (!globalThis.Worker) globalThis.Worker = Worker;

export const name = 'dicexp'

export interface Config {
  heartbeatTimeout: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    heartbeatTimeout: Schema.number().default(1000),
  }),
]).i18n({
  'zh-CN': I18nZhCN._config,
  zh: I18nZhCN._config,
  'en-US': I18nEnUS._config,
  en: I18nEnUS._config,
})

export async function applyReal(ctx: Context, config: Config) {
  const { EvaluatingWorkerManager } = await import('@dicexp/naive-evaluator-in-worker')

  const workerJsUrl = new URL(
    pathToFileURL(path.join(__dirname, '../resources/worker.js')),
  )
  const workerProvider = () => new Worker(workerJsUrl)
  const evaluate = (exp: string, seed: number) =>
    new Promise<EvaluationResult>((resolve) => {
      const manager = new EvaluatingWorkerManager(
        workerProvider,
        async (ready) => {
          if (!ready) return
          const result = await manager.evaluateRemote(exp, {
            execution: { seed },
          })
          manager.destroy()
          resolve(result)
        },
        { newEvaluatorOptions: { randomSourceMaker: 'xorshift7' } },
        { heartbeatTimeout: { ms: config.heartbeatTimeout } },
      )
    })

  ctx.i18n.define('zh-CN', I18nZhCN)
  ctx.i18n.define('zh', I18nZhCN)
  ctx.i18n.define('en-US', I18nEnUS)
  ctx.i18n.define('en', I18nEnUS)

  ctx
    .command('dicexp <exp:text>')
    .option('seed', '-s [seed:number]')
    .option('verbose', '-v [verbose:boolean]')
    .action(async ({ session, options }, exp) => {
      if (!session || !options) return
      if (!exp) return session.execute('help dicexp')

      const seed = options.seed || crypto.getRandomValues(new Uint32Array(1))[0]!
      const result = await evaluate(exp, seed)

      if (result[0] === 'ok') {
        const res = JSON.stringify(result[1])
        return options.verbose
          ? session.text('dicexp.reply.result-verbose', [seed, res])
          : session.text('dicexp.reply.result', [res])
      }

      const [, type, err] = result
      const errMsg = err.message
      return session.text('dicexp.reply.error', [
        session.text(`dicexp.error.${type}`),
        errMsg,
      ])
    })
}

export async function apply(ctx: Context, config: Config) {
  try {
    await applyReal(ctx, config)
  } catch (e) {
    setTimeout(() => ctx.scope.dispose())
    throw e
  }
}
