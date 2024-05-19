;(async () => {
  const { Evaluator, asScope } = await import('@dicexp/naive-evaluator')
  const { functionScope, operatorScope } = await import(
    '@dicexp/naive-evaluator-builtins'
  )
  const { startWorkerServer } = await import('@dicexp/naive-evaluator-in-worker')

  const topLevelScope = asScope([operatorScope, functionScope])

  startWorkerServer((opts) => new Evaluator(opts), topLevelScope)
})()
