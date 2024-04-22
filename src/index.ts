import { Context, Schema } from 'koishi';

export const name = 'dicexp';

export interface Config {}

export const Config: Schema<Config> = Schema.object({});

export async function applyReal(ctx: Context) {
  const { Evaluator, asScope } = await import('@dicexp/naive-evaluator');
  const { functionScope, operatorScope } = await import(
    '@dicexp/naive-evaluator-builtins'
  );

  const topLevelScope = asScope([operatorScope, functionScope]);
  const evaluator = new Evaluator({
    topLevelScope,
    randomSourceMaker: 'xorshift7',
  });

  ctx.i18n.define('zh-CN', require('./locales/zh-CN.yml'));
  ctx.i18n.define('zh', require('./locales/zh-CN.yml'));
  ctx.i18n.define('en-US', require('./locales/en-US.yml'));
  ctx.i18n.define('en', require('./locales/en-US.yml'));

  ctx
    .command('dicexp <exp:text>')
    .option('seed', '-s [seed:number]')
    .option('verbose', '-v [verbose:boolean]')
    .action(async ({ session, options }, exp) => {
      if (!exp) return session.execute('help dicexp');

      const seed =
        options.seed || crypto.getRandomValues(new Uint32Array(1))[0]!;
      const result = evaluator.evaluate(exp, {
        execution: { seed },
      });

      console.log(options.verbose);
      if (result[0] === 'ok') {
        const res = JSON.stringify(result[1]);
        return options.verbose
          ? session.text('dicexp.reply.result-verbose', [seed, res])
          : session.text('dicexp.reply.result', [res]);
      }

      const [, type, err] = result;
      const errMsg = err.message;
      return session.text('dicexp.reply.error', [
        session.text(`dicexp.error.${type}`),
        errMsg,
      ]);
    });
}

export async function apply(ctx: Context) {
  try {
    await applyReal(ctx);
  } catch (e) {
    setTimeout(() => ctx.scope.dispose());
    throw e;
  }
}
