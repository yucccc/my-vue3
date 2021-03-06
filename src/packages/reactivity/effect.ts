import { isArray } from '../shared'
import { ITERATE_KEY } from './reactive'

// 桶子最终的数据格式如下
// const test_target = { o: 1 }
// // 最外面一层是WeakMap
// const test = new WeakMap([
//   // WeakMap 由target和Map组成
//   [
//     test_target,
//     new Map([
//       ['o', new Set(['effect1', 'effect2'])],
//     ]),
//   ],
// [
//     test_target2,
//     new Map([
//       ['o', new Set(['effect1', 'effect2'])],
//     ]),
//   ],

// ])
type KeyToDepMap = Map<any, Set<any>>
const bucket = new WeakMap<any, KeyToDepMap>()

// 当前激活的副作用函数
export let activeEffect: Function
export let shouldTrack = true
export function pauseTracking() {
  shouldTrack = false
}

export function enableTracking() {
  shouldTrack = true
}
export interface ReactiveEffectOptions {
  lazy?: boolean
  scheduler?: Function
  // scope?: Function
  // allowRecurse?: boolean
  // onStop?: () => void
}

// 逻辑上其实我们只需要将数据变成响应式的 那么当

// effect 栈
const effectStack = []
/**
 * 副作用实现
 * @param fn
 * @param options
 */
export function effect<T = any>(fn: () => T, options: ReactiveEffectOptions = {}) {
  const effectFn = () => {
    // 执行前将该副作用的收集依赖清除
    cleanupEffect(effectFn)
    activeEffect = effectFn
    // 在调用副作用函数之前将当前副作用函数压栈
    effectStack.push(effectFn)
    const res = fn()
    // 在当前副作用函数执行完毕后，将当前副作用函数弹出栈，并还原 activeEffect 为之前的值
    effectStack.pop()
    activeEffect = effectStack[effectStack.length - 1]
    return res
  }
  // 执行时给effectFn
  effectFn.deps = []
  effectFn.options = options

  // 目前用于computed 一开始不立刻执行
  if (!options.lazy) { effectFn() }

  return effectFn
}

// 思考：执行这个副作用有什么用呢？ 答案：其实后面很多逻辑都是依靠于副作用的重新执行
// 比如组件的重新渲染 当数据更新后 需要重新执行effect effect里面是更新组件的一些逻辑

// // 当我们某个数据变更的时候 想要执行某个副作用
// const obj = { text: 'hello vue3' }

// //  修改obj.text 当值变化的时候 重新执行下副作用effect 修改document.body.innerText
// obj.text = 'hello vite'

export const enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear',
}
export function track(target, key) {
  if (!activeEffect || !shouldTrack) { return }

  let depsMap = bucket.get(target)

  // 如果不存在depsMap
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()))
  }

  let deps = depsMap.get(key)

  if (!deps) {
    depsMap.set(key, (deps = new Set()))
  }

  deps.add(activeEffect)
  // deps
  // 将其添加到activeEffect.deps中 这段逻辑在 effectFn.deps = []
  // 读取的每个值都会被收集
  activeEffect.deps.push(deps)
}

export function trigger(
  target: any,
  key: string | symbol,
  type: TriggerOpTypes,
  newValue?: unknown,
  oldValue?: unknown,
) {
  const depsMap = bucket.get(target)
  if (!depsMap) { return }

  const effects = depsMap.get(key)

  const effectsToRun = new Set()

  // TODO 一旦判断是否等于activeEffect就有问题 待查看
  effects && effects.forEach((effectFn) => {
    if (effectFn !== activeEffect) { effectsToRun.add(effectFn) }
  })
  // 新增或者减少都会导致for循环的次数变更 所以需要重新执行
  if (type === TriggerOpTypes.ADD || type === TriggerOpTypes.DELETE) {
    // 把ITERATE_KEY取出来执行
    const iterateEffects = depsMap.get(ITERATE_KEY)
    iterateEffects && iterateEffects.forEach((effectFn) => {
      effectsToRun.add(effectFn)
    })
  }
  // 如果是数组并且修改了数组的length属性
  if (isArray(target) && key === 'length' && typeof newValue !== 'symbol') {
    // 索引大于或者等于新length的元素
    // 需要吧相关联的副作用函数取出来并添加到effectToRun中待执行
    depsMap.forEach((effects, key) => {
      if (typeof key !== 'symbol') { // 这个symbol后期需要优化判断
        if (key >= (newValue as number)) {
          effects.forEach((effectFn) => {
            if (effectFn !== activeEffect) { effectsToRun.add(effectFn) }
          })
        }
      }
    })
  }

  effectsToRun.forEach((effectFn) => {
    if (effectFn.options.scheduler) { effectFn.options.scheduler() }
    else { effectFn() }
  })
}

export function cleanupEffect(effect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) { deps[i].delete(effect) }
    deps.length = 0
  }
}
