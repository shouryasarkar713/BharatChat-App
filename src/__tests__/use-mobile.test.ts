import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from '../hooks/use-mobile'

describe('useIsMobile hook', () => {
  let changeCallback: () => void

  beforeEach(() => {
    // Mock window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: jest.fn().mockImplementation((query) => ({
        matches: window.innerWidth < 768,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn().mockImplementation((event, cb) => {
          if (event === 'change') changeCallback = cb
        }),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should return true if window.innerWidth is less than 768px', () => {
    window.innerWidth = 500
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('should return false if window.innerWidth is greater than or equal to 768px', () => {
    window.innerWidth = 1024
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('should update value when window matches change event', () => {
    window.innerWidth = 1024
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    // Simulate resizing window
    window.innerWidth = 400
    act(() => {
      if (changeCallback) changeCallback()
    })

    expect(result.current).toBe(true)
  })
})
