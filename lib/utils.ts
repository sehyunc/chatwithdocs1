import { clsx, type ClassValue } from 'clsx'
import { customAlphabet } from 'nanoid'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  7
) // 7-character random string

export async function fetcher<JSON = any>(input: RequestInfo, init?: RequestInit): Promise<JSON> {
  const res = await fetch(input, init)

  if (!res.ok) {
    const json = await res.json()
    if (json.error) {
      const error = new Error(json.error) as Error & {
        status: number
      }
      error.status = res.status
      throw error
    } else {
      throw new Error('An unexpected error occurred')
    }
  }

  return res.json()
}

export function formatDate(input: string | number | Date): string {
  const date = new Date(input)
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function parseGitHubURL(url: string): { owner: string; repo: string; path: string } | null {
  // Regex to match owner, repo, and optionally the path after 'tree' or 'blob'
  const regex = /https:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/(tree|blob)\/[^\/]+\/(.*))?/
  const match = url.match(regex)

  if (match) {
    return {
      owner: match[1],
      repo: match[2],
      // If path is not present, default to an empty string
      path: match[4] ? match[4] : '',
    }
  } else {
    return null // Or throw an error, depending on how you want to handle this
  }
}
