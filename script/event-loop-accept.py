import time

from playwright.sync_api import sync_playwright


def wait_for_text(page, text, timeout_ms=30000):
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if text in page.locator('body').inner_text():
            return True
        page.wait_for_timeout(500)
    return False


def main():
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')

        # 1. 菜单出现 Event Loop 卡片
        card = page.locator('text=Event Loop')
        assert card.count() >= 1, 'menu card missing'
        card.first.click()
        page.wait_for_timeout(500)

        # 2. 三张预设卡片
        assert page.locator('text=入门 · 宏任务 vs 微任务').count() >= 1, 'preset cards missing'
        page.locator('text=入门 · 宏任务 vs 微任务').first.click()
        page.wait_for_timeout(800)
        page.screenshot(path='/tmp/el-basic-initial.png')

        # 3. 舞台元素齐全
        for t in ['调用栈', 'Web APIs', '宏任务队列', '微任务队列', 'Console',
                  '① 任务（宏任务）', '② 微任务', '③ 渲染', '代码', '步骤 1/24',
                  '设计 60 FPS', '实时']:
            assert page.locator(f'text={t}').count() >= 1, f'missing stage element: {t}'
        fullscreen_button = page.locator('button', has_text='⛶ 全屏').first
        assert fullscreen_button.count() == 1, 'fullscreen button missing'
        fullscreen_button.click()
        page.wait_for_timeout(300)
        fullscreen_state = page.locator('button', has_text='⛶ 退出全屏').count() + page.locator('button', has_text='⛶ 退出沉浸').count()
        assert fullscreen_state == 1, 'fullscreen or immersive mode did not activate'
        assert page.locator('text=调用栈').count() >= 1, 'stage missing in fullscreen'
        assert page.locator('text=设计 60 FPS').count() >= 1, 'FPS missing in fullscreen'
        page.locator('button', has_text='⛶').first.click()
        page.wait_for_timeout(300)
        assert page.locator('button', has_text='⛶ 全屏').count() == 1, 'fullscreen exit failed'
        results.append('全屏/FPS: 舞台与控制栏可进入全屏或沉浸模式, 设计 60 FPS 可见')

        # 4. 2x 播放到终点，输出与步数比对（轮询等待，headless 渲染可能慢于实时）
        page.locator('button', has_text='2x').first.click()
        page.locator('button', has_text='▶ 播放').first.click()
        assert wait_for_text(page, '24/24'), 'basic did not reach 24/24'
        page.screenshot(path='/tmp/el-basic-end.png')
        body = page.locator('body').inner_text()
        for line in ['1: sync', '2: sync end', '3: then', '4: timeout', '24/24']:
            assert line in body, f'basic missing: {line}'
        results.append('basic: 播放结束输出 4 条顺序正确, 步数 24/24')

        # 5. 单步回退
        page.locator('button', has_text='↶ 上一步').first.click()
        page.wait_for_timeout(300)
        assert '23/24' in page.locator('body').inner_text(), 'step back failed'
        results.append('单步回退: 23/24')

        # 6. 进度点跳步
        page.locator('button[aria-label="跳到步骤 10"]').click()
        page.wait_for_timeout(300)
        assert '10/24' in page.locator('body').inner_text(), 'dot jump failed'
        results.append('进度点跳步: 10/24')

        # 7. 重播
        page.locator('button', has_text='⏮ 重播').first.click()
        assert wait_for_text(page, '1/24', 3000), 'replay failed'
        results.append('重播: 回到 1/24')

        # 8. 预设2 await
        page.locator('button', has_text='← 换个预设').first.click()
        page.wait_for_timeout(300)
        page.locator('text=进阶 · await 与微任务').first.click()
        page.wait_for_timeout(500)
        page.locator('button', has_text='2x').first.click()
        page.locator('button', has_text='▶ 播放').first.click()
        assert wait_for_text(page, '30/30'), 'await did not reach 30/30'
        body = page.locator('body').inner_text()
        for line in ['1: a start', '2: sync end', '3: a resumed', '4: micro', '5: timeout', '30/30']:
            assert line in body, f'await missing: {line}'
        results.append('await: 播放结束输出 5 条顺序正确, 步数 30/30')

        # 9. 预设3 render（含 rAF 渲染阶段）
        page.locator('button', has_text='← 换个预设').first.click()
        page.wait_for_timeout(300)
        page.locator('text=综合 · 渲染帧时机').first.click()
        page.wait_for_timeout(500)
        page.screenshot(path='/tmp/el-render-initial.png')
        page.locator('button', has_text='2x').first.click()
        page.locator('button', has_text='▶ 播放').first.click()
        assert wait_for_text(page, '27/27'), 'render did not reach 27/27'
        body = page.locator('body').inner_text()
        for line in ['1: sync', '2: then', '3: timeout', '4: raf', '27/27']:
            assert line in body, f'render missing: {line}'
        results.append('render: 播放结束输出 4 条顺序正确(rAF 最后), 步数 27/27')

        browser.close()
    print('\n'.join(f'✅ {r}' for r in results))
    print('ALL CHECKS PASSED')


main()
