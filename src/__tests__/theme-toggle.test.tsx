import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ThemeToggle } from '../components/chat/theme-toggle'
import { useTheme } from 'next-themes'

// Mock next-themes
const mockSetTheme = jest.fn()
jest.mock('next-themes', () => ({
  useTheme: jest.fn(() => ({
    theme: 'light',
    setTheme: mockSetTheme,
  })),
}))

describe('ThemeToggle Component', () => {
  beforeEach(() => {
    mockSetTheme.mockClear()
  })

  it('renders a button immediately before hydration (unmounted state)', async () => {
    render(<ThemeToggle />)
    const button = screen.getByLabelText('Toggle theme')
    expect(button).toBeInTheDocument()

    // Resolve the mounting state update inside act to avoid console warnings
    await act(async () => {
      await Promise.resolve()
    })
  })

  it('renders standard toggle with theme title after mount/hydration', async () => {
    // Mock the useTheme to return 'light' theme
    ;(useTheme as jest.Mock).mockReturnValue({
      theme: 'light',
      setTheme: mockSetTheme,
    })

    render(<ThemeToggle />)

    // Wait for the hydration useEffect microtask
    await act(async () => {
      await Promise.resolve()
    })

    const button = screen.getByLabelText('Switch to dark mode')
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('title', 'Switch to dark mode')
  })

  it('calls setTheme to change theme from light to dark on click', async () => {
    ;(useTheme as jest.Mock).mockReturnValue({
      theme: 'light',
      setTheme: mockSetTheme,
    })

    render(<ThemeToggle />)

    await act(async () => {
      await Promise.resolve()
    })

    const button = screen.getByLabelText('Switch to dark mode')
    fireEvent.click(button)

    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('calls setTheme to change theme from dark to light on click', async () => {
    ;(useTheme as jest.Mock).mockReturnValue({
      theme: 'dark',
      setTheme: mockSetTheme,
    })

    render(<ThemeToggle />)

    await act(async () => {
      await Promise.resolve()
    })

    const button = screen.getByLabelText('Switch to light mode')
    fireEvent.click(button)

    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })
})
