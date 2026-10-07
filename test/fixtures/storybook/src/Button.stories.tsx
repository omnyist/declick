import { render } from '@storybook/react'
import { useState } from 'react'
import { expect } from 'vitest'
import { userEvent } from '@testing-library/user-event'
import { within } from 'storybook/test'

const meta = { title: 'Group/Button', component: render }

export const BadStory = {
  name: 'Bad Story',
  render: () => {
    const [count] = useState(0)
    return <button>{count}</button>
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button'))
    expect(meta).toBeDefined()
  },
}

export const bad_case = {}
