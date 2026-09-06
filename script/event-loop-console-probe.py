import re

from playwright.sync_api import sync_playwright

consoles = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.on('console', lambda m: consoles.append(f'{m.type}: {m.text}'))
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    page.locator('text=Event Loop').first.click()
    page.wait_for_timeout(400)
    page.locator('text=入门 · 宏任务 vs 微任务').first.click()
    page.wait_for_timeout(800)
    page.locator('button', has_text='2x').first.click()
    page.locator('button', has_text='▶ 播放').first.click()
    page.wait_for_timeout(3000)
    body = page.locator('body').inner_text()
    m = re.search(r'步骤 (\d+/\d+)', body)
    print('counter after 3s:', m.group(1) if m else '?')
    print('--- console (first 12) ---')
    for c in consoles[:12]:
        print(c[:220])
    browser.close()
