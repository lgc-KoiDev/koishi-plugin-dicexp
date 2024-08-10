import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { Context, pick, Schema } from 'koishi'
import Worker from 'web-worker'

import I18nEnUS from './locales/en-US.yml'
import I18nZhCN from './locales/zh-CN.yml'

import type { EvaluationResult } from '@dicexp/interface'
import { transformRepr } from './steps-repr'

// if (!globalThis.Worker) globalThis.Worker = Worker;

export const name = 'dicexp'

export interface Config {
  heartbeatTimeout: number

  listPreviewLimit?: number
  sumPreviewLimit?: number
  autoExpansionDepthLimit?: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    heartbeatTimeout: Schema.number().default(1000),
  }),
  Schema.object({
    listPreviewLimit: Schema.number().default(3).step(1).min(-1),
    sumPreviewLimit: Schema.number().default(10).step(1).min(-1),
    autoExpansionDepthLimit: Schema.number().default(20).step(1).min(-1),
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
    .option('debug', '-d [debug:boolean]')
    .action(async ({ session, options }, exp) => {
      if (!session || !options) return
      if (!exp) return session.execute('help dicexp')

      const seed = options.seed || crypto.getRandomValues(new Uint32Array(1))[0]!
      const result = await evaluate(exp, seed)

      if (result[0] !== 'ok') {
        const [, type, err] = result
        const errMsg = err.message
        return session.text('dicexp.reply.error', [
          session.text(`dicexp.error.${type}`),
          errMsg,
        ])
      }

      const res = JSON.stringify(result[1])
      const appendix = result[2]

      if (options.debug) {
        const ctx = Object.fromEntries(
          Object.entries(
            pick(config, [
              'listPreviewLimit',
              'sumPreviewLimit',
              'autoExpansionDepthLimit',
            ]),
          ).map(([k, v]) => [k, v === -1 ? undefined : v]),
        )
        const reprMsg = transformRepr(appendix.representation, ctx)
        return session.text('dicexp.reply.result-debug', [
          seed,
          res,
          appendix.statistics.timeConsumption.ms,
          reprMsg,
        ])
      }

      if (options.verbose) {
        return session.text('dicexp.reply.result-verbose', [
          seed,
          res,
          appendix.statistics.timeConsumption.ms,
        ])
      }

      return session.text('dicexp.reply.result', [res])
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
