import React from 'react'
import { render, screen } from '@testing-library/react'
import { Avatar } from '../components/chat/avatar'

describe('Avatar Component', () => {
  it('should render the initials of the user name', () => {
    render(<Avatar name="Alice Chen" />)
    expect(screen.getByText('AC')).toBeInTheDocument()
  })

  it('should render initials for single word names', () => {
    render(<Avatar name="Bob" />)
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('should render an image when src is provided', () => {
    const testSrc = 'https://example.com/avatar.png'
    render(<Avatar name="Alice Chen" src={testSrc} />)
    
    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', testSrc)
    expect(img).toHaveAttribute('alt', 'Alice Chen')
  })

  it('should display status dot when showStatus is true', () => {
    const { container } = render(<Avatar name="Alice" showStatus={true} online={true} />)
    // Find the status indicator dot span
    const dot = container.querySelector('span')
    expect(dot).toBeInTheDocument()
    expect(dot).toHaveClass('bg-emerald-500')
  })

  it('should display offline status dot when online is false', () => {
    const { container } = render(<Avatar name="Alice" showStatus={true} online={false} />)
    const dot = container.querySelector('span')
    expect(dot).toBeInTheDocument()
    expect(dot).toHaveClass('bg-slate-400')
  })
})
