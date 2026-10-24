// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Field, Tabs, tabLabelId } from './ui';

afterEach(cleanup);

describe('shared input and navigation behavior', () => {
  it('keeps a readable panel name when the selected value contains spaces', () => {
    render(
      <>
        <Tabs
          value="2.4 GHz"
          onChange={() => {}}
          panelId="band"
          items={[{ id: '2.4 GHz', label: '2.4 GHz' }]}
        />
        <div role="tabpanel" id="band" aria-labelledby={tabLabelId('band', '2.4 GHz')}>
          频段内容
        </div>
      </>,
    );
    expect(screen.getByRole('tabpanel', { name: '2.4 GHz' })).toBeTruthy();
  });
  it('keeps field instructions separate from the accessible name and focuses from its label', async () => {
    const user = userEvent.setup();
    render(
      <Field label="服务器" hint="留空使用当前网卡">
        <input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: '服务器' });
    const hint = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('留空使用当前网卡');
    await user.click(screen.getByText('服务器'));
    expect(document.activeElement).toBe(input);
  });

  it('uses one tab stop and switches the selected panel with arrows, Home and End', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('one');
      return (
        <>
          <Tabs
            value={value}
            onChange={setValue}
            label="诊断类型"
            panelId="panel"
            items={[
              { id: 'one', label: 'Ping' },
              { id: 'two', label: '路由追踪' },
              { id: 'three', label: '端口' },
            ]}
          />
          <div id="panel" role="tabpanel" aria-labelledby={`panel-${value}`}>
            <input aria-label="目标" />
          </div>
        </>
      );
    }
    render(<Harness />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Ping' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('路由追踪');
    expect(screen.getByRole('tabpanel', { name: '路由追踪' })).toBeTruthy();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '端口' }));
    await user.keyboard('{Home}{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '端口' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '目标' }));
  });
});
