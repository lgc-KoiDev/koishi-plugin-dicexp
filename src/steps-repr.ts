import type * as I from '@dicexp/interface'
import { h } from 'koishi'

export type Fragment = string | h

export interface RepresentationContextData {
  depth?: number

  listPreviewLimit?: number
  sumPreviewLimit?: number
  autoExpansionDepthLimit?: number
}

export function isSimpleRepr(repr: I.Repr) {
  const t = repr[0]
  return t === '_' || t === 'vp'
}

export function isWithError(repr: I.Repr): boolean {
  if (isError(repr)) return true

  const t = repr[0]
  switch (t) {
    case 'vl':
      return repr[2]
    case 'i':
      return repr[2] ? isWithError(repr[2]) : false
    case 'cr':
    case 'cv':
      return repr[4] ? isError(repr[4]) : false
    case 'c$':
    case '#':
      return repr[3] ? isError(repr[3]) : false
    default:
      return false
  }
}

export function isError(repr: I.Repr) {
  const t = repr[0]
  return t === 'e' || t === 'E'
}

export function listJoin<T>(items: T[], separator: T) {
  const newList: T[] = []
  for (const item of items) {
    if (newList.length === 0) newList.push(item)
    else newList.push(separator, item)
  }
  return newList
}

export function separateIndirectErrorFromResult(
  result: I.Repr | undefined,
): [result: I.Repr | undefined, isIndirectError: boolean] {
  if (!result) return [undefined, false]
  if (result[0] === 'E') return [undefined, true]
  return [result, false]
}

export function handleDepthIncrease(ctx: RepresentationContextData) {
  ctx = { ...ctx }
  if (typeof ctx.depth === 'number') ctx.depth += 1
  else ctx.depth = 0
  if (
    typeof ctx.autoExpansionDepthLimit === 'number' &&
    ctx.depth >= ctx.autoExpansionDepthLimit
  ) {
    ctx.listPreviewLimit = 0
    ctx.sumPreviewLimit = 0
    ctx.autoExpansionDepthLimit = 0
  }
  return ctx
}

export function transformRepr(
  repr: I.Repr,
  ctx: RepresentationContextData,
): Fragment[] {
  ctx = handleDepthIncrease(ctx)
  if (ctx.autoExpansionDepthLimit === 0 && !isSimpleRepr(repr) && !isWithError(repr)) {
    return ['( ... )']
  }
  // Expression produces a union type that is too complex to represent.
  return reprTransformMap[repr[0]](repr as any, ctx)
}

export function transformListLike(props: {
  ctx: RepresentationContextData
  items: I.Repr[]
  leftBracket: Fragment
  rightBracket: Fragment
  separator: Fragment
  surplusItems?: I.Repr[]
  limitType?: 'list' | 'sum' | 'expand'
}): Fragment[] {
  const { items, leftBracket, rightBracket, separator, surplusItems, limitType } = props
  const ctx = handleDepthIncrease(props.ctx)

  const previewLimit = (() => {
    switch (limitType) {
      case 'list':
        return ctx.listPreviewLimit
      case 'sum':
        return ctx.sumPreviewLimit
      case 'expand': // fallthrough
      default:
        return ctx.autoExpansionDepthLimit
    }
  })()
  const shouldCollapseList =
    typeof previewLimit === 'number' && items.length > previewLimit

  const collapsedItems = shouldCollapseList ? items.slice(0, previewLimit) : items
  const finalElems = [
    leftBracket,
    ...listJoin(
      collapsedItems.map((v) => transformRepr(v, ctx)),
      [separator],
    ).flat(),
  ]
  let noContent = finalElems.length === 1

  const pushToFinal = (...items: Fragment[]) => {
    if (noContent) noContent = false
    else finalElems.push(separator)
    finalElems.push(...items)
  }

  if (shouldCollapseList) {
    const errorItemsLeft = items
      .slice(previewLimit)
      .map((v) => (isWithError(v) ? v : null))
    let leftIsSep = false
    for (const errorItem of errorItemsLeft) {
      if (errorItem) {
        pushToFinal(...transformRepr(errorItem, ctx))
      } else if (!leftIsSep) {
        pushToFinal('...')
        leftIsSep = true
      }
    }
  }

  if (surplusItems) {
    finalElems.push(
      ' ⟨ ',
      separator,
      ...transformListLike({
        ctx: {
          ...ctx,
          autoExpansionDepthLimit:
            typeof previewLimit === 'number' ? ctx.autoExpansionDepthLimit : undefined,
        },
        items: surplusItems,
        leftBracket: ' ',
        rightBracket: ' ⟩',
        separator,
      }),
    )
  }

  finalElems.push(rightBracket)
  return finalElems
}

export function packResult(
  ctx: RepresentationContextData,
  elems: Fragment[],
  result?: I.Repr,
): Fragment[] {
  if (!result) return elems
  return ['( ', ...elems, ' ⇒ ', ...transformRepr(result, ctx), ' )']
}

export function packSimple(
  ctx: RepresentationContextData,
  result: I.Repr,
  opts?: {
    spaceLeft?: boolean
    spaceRight?: boolean
  },
): Fragment[] {
  if (isSimpleRepr(result)) return transformRepr(result, ctx)
  const { spaceLeft, spaceRight } = opts ?? {}
  return [
    spaceLeft ? ' ( ' : '( ',
    ...transformRepr(result, ctx),
    spaceRight ? ' ) ' : ' )',
  ]
}

export function transformRegularFunction(
  ctx: RepresentationContextData,
  callee: string,
  args?: I.Repr[],
  result?: I.Repr,
): Fragment[] {
  const finalElems: Fragment[] = [`${callee}( `]
  if (args) {
    finalElems.push(
      ...listJoin(
        args.map((v) => transformRepr(v, ctx)),
        [' , '],
      ).flat(),
    )
  }
  finalElems.push(' )')
  return packResult(ctx, finalElems, result)
}

export function transformUnaryOperator(
  ctx: RepresentationContextData,
  callee: string,
  operand: I.Repr,
  result?: I.Repr,
): Fragment[] {
  if (callee === '+' || (callee === '-' && operand[0] === 'vp')) {
    const [, value] = operand
    if (typeof value === 'number') {
      return [`${callee}${JSON.stringify(value)}`]
    }
  }

  return packResult(ctx, [`( ${callee}`, ...packSimple(ctx, operand), ' )'], result)
}

export function transformBinaryOperator(
  ctx: RepresentationContextData,
  callee: string,
  [opLeft, opRight]: [I.Repr, I.Repr],
  result?: I.Repr,
): Fragment[] {
  return packResult(
    ctx,
    [
      `( `,
      ...packSimple(ctx, opLeft),
      ` ${callee} `,
      ...packSimple(ctx, opRight),
      ' )',
    ],
    result,
  )
}

export function transformRegularOperator(
  ctx: RepresentationContextData,
  callee: string,
  args?: I.Repr[],
  result?: I.Repr,
): Fragment[] {
  const argsLen = args?.length ?? 0
  if (argsLen === 1) {
    return transformUnaryOperator(ctx, callee, args![0], result)
  }
  if (argsLen === 2) {
    return transformBinaryOperator(ctx, callee, args as [I.Repr, I.Repr], result)
  }
  throw Error(
    `Invalid arg count for operator, expected 1 <= count <= 2, got ${argsLen}`,
  )
}

export function transformRegularPiped(
  ctx: RepresentationContextData,
  callee: string,
  args?: I.Repr[],
  result?: I.Repr,
) {
  const argsLen = args?.length ?? 0
  if (argsLen < 1) {
    throw Error(`Invalid arg count for pipe, expected at least 1, got ${argsLen}`)
  }
  const [head, ...tails] = args!
  return packResult(
    ctx,
    [
      `( `,
      ...packSimple(ctx, head),
      ` |> ${callee}`,
      ...transformListLike({
        ctx,
        items: tails,
        leftBracket: '( ',
        rightBracket: ' )',
        separator: ' ',
      }),
      ' )',
    ],
    result,
  )
}

export function transformReprFunction(
  ctx: RepresentationContextData,
  callee: I.Repr,
  args?: I.Repr[],
  result?: I.Repr,
): Fragment[] {
  return packResult(
    ctx,
    [
      `( ( `,
      ...transformRepr(callee, ctx),
      ` ).`,
      ...transformListLike({
        ctx,
        items: args ?? [],
        leftBracket: '( ',
        rightBracket: ' )',
        separator: ' , ',
      }),
      ` )`,
    ],
    result,
  )
}

export function transformReprPiped(
  ctx: RepresentationContextData,
  callee: I.Repr,
  args?: I.Repr[],
  result?: I.Repr,
): Fragment[] {
  const argsLen = args?.length ?? 0
  if (argsLen < 1) {
    throw Error(`Invalid arg count for pipe, expected at least 1, got ${argsLen}`)
  }
  const [head, ...tails] = args!
  return packResult(
    ctx,
    [
      `( `,
      ...packSimple(ctx, head),
      ' |> ',
      ...packSimple(ctx, callee),
      '.',
      ...transformListLike({
        ctx,
        items: tails,
        leftBracket: '( ',
        rightBracket: ' )',
        separator: ' ',
      }),
      ' )',
    ],
    result,
  )
}

export function transformGroupOfRegularFunctions(
  ctx: RepresentationContextData,
  head: I.Repr,
  tail: [string, I.Repr][],
  result?: I.Repr,
): Fragment[] {
  return packResult(
    ctx,
    [
      '( ',
      ...packSimple(ctx, head),
      ...tail.flatMap(([op, r]) => [` ${op} `, ...packSimple(ctx, r)]),
      ' )',
    ],
    result,
  )
}

export const reprTransformMap: {
  [key in I.Repr[0]]: (
    repr: Extract<I.Repr, { 0: key }>,
    ctx: RepresentationContextData,
  ) => Fragment[]
} = {
  r: ([, raw]) => [h('code', raw)],

  _: () => [h('code', '_')],

  vp: ([, value]) => [h('code', `${value}`)],

  vl: ([, items, , surplusItems], ctx) =>
    transformListLike({
      ctx,
      items,
      leftBracket: '[ ',
      rightBracket: ' ]',
      separator: ' , ',
      surplusItems,
      limitType: 'list',
    }),

  vs: ([, sum, addends, surplusAddends], ctx) => [
    '( ',
    ...transformListLike({
      ctx,
      items: addends,
      leftBracket: '( ',
      rightBracket: ' )',
      separator: ' + ',
      surplusItems: surplusAddends,
      limitType: 'sum',
    }),
    ` = ${sum} )`,
  ],

  i: ([, name, value], ctx) =>
    value ? [`( ${name} = `, ...transformRepr(value, ctx), ' )'] : [name],

  cr: ([, style, callee, args, rawResult], ctx) => {
    const [result] = separateIndirectErrorFromResult(rawResult)
    switch (style) {
      case 'f':
        return transformRegularFunction(ctx, callee, args, result)
      case 'o':
        return transformRegularOperator(ctx, callee, args, result)
      case 'p':
        return transformRegularPiped(ctx, callee, args, result)
    }
  },

  cv: ([, style, callee, args, rawResult], ctx) => {
    const [result] = separateIndirectErrorFromResult(rawResult)
    switch (style) {
      case 'f':
        return transformReprFunction(ctx, callee, args, result)
      case 'p':
        return transformReprPiped(ctx, callee, args, result)
    }
  },

  c$: ([, head, tail, rawResult], ctx) => {
    const [result] = separateIndirectErrorFromResult(rawResult)
    return transformGroupOfRegularFunctions(ctx, head, tail, result)
  },

  // eslint-disable-next-line @typescript-eslint/naming-convention
  '&': ([, name, arity], ctx) => [`( &${name}/${arity} )`],

  // eslint-disable-next-line @typescript-eslint/naming-convention
  '#': ([, count, body, rawResult], ctx) => {
    const [result] = separateIndirectErrorFromResult(rawResult)
    return packResult(
      ctx,
      [
        `( `,
        ...packSimple(ctx, count, { spaceRight: true }),
        `#`,
        ...packSimple(ctx, ['r', body], { spaceLeft: true }),
        ` )`,
      ],
      result,
    )
  },

  e: ([, errorMessage, source], ctx) => {
    const finalElems: Fragment[] = ['( ']
    if (source) finalElems.push(...packSimple(ctx, source))
    finalElems.push(`错误：「${errorMessage}」！ )`)
    return finalElems
  },

  E: () => ['实现细节泄漏：此处是间接错误，不应展现在步骤中！'],

  d: ([, type, inner], ctx) => [type, ...transformRepr(inner, ctx)],
}
