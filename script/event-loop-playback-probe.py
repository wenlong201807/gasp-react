import re
import time

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    page.locator('text=Event Loop').first.click()
    page.wait_for_timeout(400)
    page.locator('text=入门 · 宏任务 vs 微任务').first.click()
    page.wait_for_timeout(800)
    page.locator('button', has_text='2x').first.click()
    page.locator('button', has_text='▶ 播放').first.click()
    for i in range(12):
        page.wait_for_timeout(2000)
        body = page.locator('body').inner_text()
        m = re.search(r'步骤 (\d+/\d+)', body)
        btn = page.locator('button', has_text='⏸').count()
        print(f't={(i+1)*2}s counter={m.group(1) if m else "?"} pauseBtn={btn}')
    page.screenshot(path='/tmp/probe-end.png')
    print('errors:', errors[:3] or '(none)')
    browser.close()
