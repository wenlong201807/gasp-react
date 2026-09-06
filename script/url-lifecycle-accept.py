import re
import sys
import time

from playwright.sync_api import sync_playwright

# 用法：
#   python3 script/url-lifecycle-accept.py --help
#   python3 /Users/zhuwenlong/.claude/skills/webapp-testing/scripts/with_server.py \\
#     --server "pnpm dev" --port 5173 -- python3.11 script/url-lifecycle-accept.py
# 脚本默认连接 http://localhost:5173；服务生命周期由 with_server.py 管理。

if '--help' in sys.argv or '-h' in sys.argv:
    print('URL 生命周期浏览器验收')
    print('用法: python3 script/url-lifecycle-accept.py')
    print('推荐: python3 /Users/zhuwenlong/.claude/skills/webapp-testing/scripts/with_server.py --server "pnpm dev" --port 5173 -- python3.11 script/url-lifecycle-accept.py')
    print('覆盖: 两幕舞台、播放控制、全屏/沉浸降级、外部 exitFullscreen 状态同步、缓存徽标与 pageerror')
    raise SystemExit(0)

# 步号计数器文案形如 01/20、14/14（DetailBar 里 String(index+1).padStart(2,'0')/total）
COUNTER_RE = re.compile(r'^\d{2}/\d{2}$')


def wait_for_text(page, text, timeout_ms=30000):
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if text in page.locator('body').inner_text():
            return True
        page.wait_for_timeout(500)
    return False


def has_text(page, text):
    return page.get_by_text(text).count() >= 1


def counter(page):
    """读 DetailBar 步号（唯一一个内容恰为 NN/NN 的 span）"""
    loc = page.locator('span').filter(has_text=COUNTER_RE).first
    if loc.count() == 0:
        return None
    text = loc.inner_text().strip()
    return text if COUNTER_RE.match(text) else None


def wait_for_counter(page, expected, timeout_ms=8000):
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if counter(page) == expected:
            return True
        page.wait_for_timeout(100)
    return False


def wait_for_any(page, texts, timeout_ms=30000):
    """轮询直到 body 出现任一文本（用于 2x 播放中捕捉瞬态文案）"""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        body = page.locator('body').inner_text()
        for t in texts:
            if t in body:
                return t
        page.wait_for_timeout(150)
    return None


def check(page, t):
    assert has_text(page, t), f'missing stage element: {t}'


def main():
    results = []
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')

        # 1. 菜单出现 🌐 URL Lifecycle 卡片，点击进入两幕选择页
        page.wait_for_selector('text=URL Lifecycle', timeout=15000)
        card = page.locator('text=URL Lifecycle')
        assert card.count() >= 1, 'menu card missing'
        card.first.click()
        assert wait_for_text(page, 'URL 生命周期 · 选择一幕', 8000), 'scenario picker missing'
        for t in ['首次加载', 'F5 刷新', '20 步 · 每步 1.6s', '14 步 · 每步 1.6s']:
            check(page, t)
        results.append('菜单/选择页: 🌐 URL Lifecycle 卡片可进入 ScenarioPicker，两幕卡片(首次加载/F5 刷新)齐全')

        # 2. 点「首次加载」进入舞台，七节点/TLS/六泳道/DetailBar/控制栏齐全
        page.locator('text=首次加载').first.click()
        assert wait_for_counter(page, '01/20'), 'first-load stage did not mount at 01/20'
        for t in ['CDN 边缘节点', 'Nginx 源站', '本地 DNS（递归）', 'TLS 握手', '缓存判定 Cache',
                  'Parse HTML', 'Composite', 'https://www.example.com/index.html',
                  '⏮ 重播', '↶ 上一步', '⏭ 单步', '0.5x', '1x', '2x']:
            check(page, t)
        assert page.locator('button[aria-label="跳到步骤 20"]').count() == 1, 'progress dots missing'
        assert page.locator('button', has_text='▶ 播放').count() == 1, 'play button missing'
        fullscreen_button = page.locator('button[aria-label="进入全屏"]')
        assert fullscreen_button.count() == 1, 'fullscreen button missing'
        experience = page.locator('[class*="experience"]').first
        header = page.locator('header[class*="header"]').first
        assert experience.locator('[class*="stageWrap"]').count() == 1, 'stage is outside fullscreen target'
        assert experience.locator('[class*="controlsBar"]').count() == 1, 'controls are outside fullscreen target'
        assert header.count() == 1, 'header missing'
        assert header.locator('xpath=ancestor::*[contains(@class, "experience")]').count() == 0, 'header must stay outside fullscreen target'
        fullscreen_button.click()
        page.wait_for_timeout(300)
        fullscreen_active = page.locator('button[aria-label="退出全屏"]').count() == 1
        immersive_active = page.locator('button[aria-label="退出沉浸"]').count() == 1
        assert fullscreen_active or immersive_active, 'fullscreen and immersive fallback both failed'
        if immersive_active:
            assert page.locator('[class*="immersive"]').count() == 1, 'immersive class missing'
            page.locator('button[aria-label="退出沉浸"]').click()
        else:
            page.evaluate("document.exitFullscreen()")
            assert wait_for_text(page, '⛶ 全屏', 3000), 'fullscreenchange did not sync after external exit'
        assert wait_for_text(page, '⛶ 全屏', 3000), 'fullscreen exit failed'
        results.append(f'全屏入口: 舞台/控制栏边界正确，进入{"原生全屏" if fullscreen_active else "沉浸降级"}后可退出')
        results.append('幕一舞台: 七节点/TLS 握手区/缓存判定区/六泳道/控制栏齐全，步号 01/20，进度点 20 个')

        # 3. 2x 播放到终点，DetailBar 末步文案含 Composite
        page.locator('button', has_text='2x').first.click()
        page.locator('button', has_text='▶ 播放').first.click()
        assert wait_for_text(page, '20/20'), 'first-load did not reach 20/20'
        detail_bar = page.locator('span').filter(has_text=COUNTER_RE).first.locator('xpath=..')
        assert 'Composite' in detail_bar.inner_text(), 'final DetailBar missing Composite'
        results.append('幕一播放: 2x 推进到 20/20，DetailBar 末步文案为 Composite（GPU 合成上屏）')

        # 4. 单步回退
        page.locator('button', has_text='↶ 上一步').first.click()
        assert wait_for_counter(page, '19/20'), 'step back failed'
        results.append('单步回退: 20/20 → 19/20')

        # 5. 进度点跳步（aria-label 跳到步骤 N）
        page.locator('button[aria-label="跳到步骤 10"]').click()
        assert wait_for_counter(page, '10/20'), 'dot jump failed'
        results.append('进度点跳步: aria-label=跳到步骤 10 → 10/20')

        # 6. 重播回到第 1 步
        page.locator('button', has_text='⏮ 重播').first.click()
        assert wait_for_counter(page, '01/20', 4000), 'replay failed'
        results.append('重播: ⏮ 重播回到 01/20')

        # 7. 返回选择页并切到幕二（key 重建，等舞台挂载）
        page.locator('button', has_text='← 换一幕').first.click()
        assert wait_for_text(page, 'URL 生命周期 · 选择一幕', 8000), 'back to picker failed'
        page.locator('text=F5 刷新').first.click()
        assert wait_for_counter(page, '01/14'), 'refresh stage did not mount at 01/14'
        check(page, '⌘R / F5')
        results.append('切幕: ← 换一幕返回选择页 → F5 刷新幕重建，步号归 01/14 且出现 ⌘R / F5 徽标')

        # 8. 幕二 2x 播放到 14/14，途中捕捉 304；再逐步验证 304 / disk cache 徽标内容
        page.locator('button', has_text='2x').first.click()
        page.locator('button', has_text='▶ 播放').first.click()
        seen = wait_for_any(page, ['服务器比对：304', '14/14'], 40000)
        assert wait_for_text(page, '14/14'), 'refresh did not reach 14/14'
        assert seen is not None, 'neither 304 copy nor end-of-play observed'
        page.screenshot(path='/tmp/url-lifecycle-final.png')
        assert wait_for_counter(page, '14/14'), 'counter not 14/14'
        page.locator('button[aria-label="跳到步骤 6"]').click()
        assert wait_for_counter(page, '06/14'), 'dot jump to step 6 failed'
        detail_bar = page.locator('span').filter(has_text=COUNTER_RE).first.locator('xpath=..')
        assert '服务器比对：304' in detail_bar.inner_text(), 'step 6 missing 304 copy'
        assert page.get_by_text('304（无响应体）').count() >= 1, 'step 6 missing 304 packet label'
        assert page.locator('[data-cache-panel]').get_by_text('200 (from disk cache)').count() == 0, 'disk cache chip should be hidden at step 6'
        results.append(f'幕二 304: 2x 推进到 14/14，第 6 步徽标 304 Not Modified（播放中实时捕捉={seen == "服务器比对：304"}）')

        page.locator('button[aria-label="跳到步骤 9"]').click()
        assert wait_for_counter(page, '09/14'), 'dot jump to step 9 failed'
        assert 'from disk cache' in detail_bar.inner_text(), 'step 9 missing disk cache copy'
        assert page.locator('[data-cache-panel]').get_by_text('200 (from disk cache)').count() == 1, 'disk cache chip missing at step 9'
        results.append('幕二 disk cache: 第 9 步出现 200 (from disk cache) 徽标与文案')

        # 9. 全程无 pageerror
        assert not errors, f'pageerror captured: {errors}'
        results.append('无报错: 全程 pageerror 队列为空')

        browser.close()
    print('\n'.join(f'✅ {r}' for r in results))
    print('ALL CHECKS PASSED')


main()
