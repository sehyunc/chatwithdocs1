import { ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
