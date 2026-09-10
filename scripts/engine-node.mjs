// assets/engine.js 를 노드에서 쓰기 위한 얇은 껍질.
// 엔진은 브라우저용 IIFE라 globalThis.IPSI_ENGINE 에 자기를 붙인다 — vm 컨텍스트 하나를 만들어
// 그 값을 꺼내 온다. 빌드 스크립트와 테스트가 화면과 **같은 파일**을 쓰게 하는 것이 목적이다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

let cached = null;

export function loadEngine(root = process.cwd()) {
  if (cached) return cached;
  const file = path.join(root, 'assets/engine.js');
  const context = { globalThis: null };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(file, 'utf8'), context, { filename: 'assets/engine.js' });
  cached = context.IPSI_ENGINE;
  return cached;
}
