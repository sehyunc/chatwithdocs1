import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import dotenv from 'dotenv'
import { ObjectExpression } from 'estree'
import GithubSlugger from 'github-slugger'
import { Content, Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { mdxFromMarkdown, MdxjsEsm } from 'mdast-util-mdx'
import { toMarkdown } from 'mdast-util-to-markdown'
import { toString } from 'mdast-util-to-string'
import { mdxjs } from 'micromark-extension-mdxjs'
import 'openai'
import { Configuration, OpenAIApi } from 'openai'
import { u } from 'unist-builder'
import { filter } from 'unist-util-filter'
import { inspect } from 'util'
import yargs from 'yargs'
import { Octokit } from '@octokit/core'
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods'
import { parseGitHubURL } from '@/lib/utils'

const MyOctokit = Octokit.plugin(restEndpointMethods)
const octokit = new MyOctokit()

dotenv.config()

const ignoredFiles = ['pages/404.mdx']

/**
 * Extracts ES literals from an `estree` `ObjectExpression`
 * into a plain JavaScript object.
 */
function getObjectFromExpression(node: ObjectExpression) {
  return node.properties.reduce<
    Record<string, string | number | bigint | true | RegExp | undefined>
  >((object, property) => {
    if (property.type !== 'Property') {
      return object
    }

    const key = (property.key.type === 'Identifier' && property.key.name) || undefined
    const value = (property.value.type === 'Literal' && property.value.value) || undefined

    if (!key) {
      return object
    }

    return {
      ...object,
      [key]: value,
    }
  }, {})
}

/**
 * Extracts the `meta` ESM export from the MDX file.
 *
 * This info is akin to frontmatter.
 */
function extractMetaExport(mdxTree: Root) {
  const metaExportNode = mdxTree.children.find((node): node is MdxjsEsm => {
    return (
      node.type === 'mdxjsEsm' &&
      node.data?.estree?.body[0]?.type === 'ExportNamedDeclaration' &&
      node.data.estree.body[0].declaration?.type === 'VariableDeclaration' &&
      node.data.estree.body[0].declaration.declarations[0]?.id.type === 'Identifier' &&
      node.data.estree.body[0].declaration.declarations[0].id.name === 'meta'
    )
  })

  if (!metaExportNode) {
    return undefined
  }

  const objectExpression =
    (metaExportNode.data?.estree?.body[0]?.type === 'ExportNamedDeclaration' &&
      metaExportNode.data.estree.body[0].declaration?.type === 'VariableDeclaration' &&
      metaExportNode.data.estree.body[0].declaration.declarations[0]?.id.type === 'Identifier' &&
      metaExportNode.data.estree.body[0].declaration.declarations[0].id.name === 'meta' &&
      metaExportNode.data.estree.body[0].declaration.declarations[0].init?.type ===
        'ObjectExpression' &&
      metaExportNode.data.estree.body[0].declaration.declarations[0].init) ||
    undefined

  if (!objectExpression) {
    return undefined
  }

  return getObjectFromExpression(objectExpression)
}

/**
 * Splits a `mdast` tree into multiple trees based on
 * a predicate function. Will include the splitting node
 * at the beginning of each tree.
 *
 * Useful to split a markdown file into smaller sections.
 */
function splitTreeBy(tree: Root, predicate: (node: Content) => boolean) {
  return tree.children.reduce<Root[]>((trees, node) => {
    const [lastTree] = trees.slice(-1)

    if (!lastTree || predicate(node)) {
      const tree: Root = u('root', [node])
      return trees.concat(tree)
    }

    lastTree.children.push(node)
    return trees
  }, [])
}

type Meta = ReturnType<typeof extractMetaExport>

type Section = {
  content: string
  heading?: string
  slug?: string
}

type ProcessedMdx = {
  checksum: string
  meta: Meta
  sections: Section[]
}

/**
 * Processes MDX content for search indexing.
 * It extracts metadata, strips it of all JSX,
 * and splits it into sub-sections based on criteria.
 */
function processMdxForSearch(content: string): ProcessedMdx {
  const checksum = createHash('sha256').update(content).digest('base64')

  const mdxTree = fromMarkdown(content, {
    extensions: [mdxjs()],
    mdastExtensions: [mdxFromMarkdown()],
  })

  const meta = extractMetaExport(mdxTree)

  // Remove all MDX elements from markdown
  const mdTree = filter(
    mdxTree,
    (node) =>
      ![
        'mdxjsEsm',
        'mdxJsxFlowElement',
        'mdxJsxTextElement',
        'mdxFlowExpression',
        'mdxTextExpression',
      ].includes(node.type)
  )

  if (!mdTree) {
    return {
      checksum,
      meta,
      sections: [],
    }
  }

  const sectionTrees = splitTreeBy(mdTree, (node) => node.type === 'heading')

  const slugger = new GithubSlugger()

  const sections = sectionTrees.map((tree) => {
    const [firstNode] = tree.children

    const heading = firstNode.type === 'heading' ? toString(firstNode) : undefined
    const slug = heading ? slugger.slug(heading) : undefined

    return {
      content: toMarkdown(tree),
      heading,
      slug,
    }
  })

  return {
    checksum,
    meta,
    sections,
  }
}

type WalkEntry = {
  path: string
  parentPath?: string
}

async function fetchGitHubDirectoryContents(owner: string, repo: string, path: string) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
    })

    const contents = response.data

    if (Array.isArray(contents)) {
      return contents
    } else {
      throw new Error('Invalid GitHub API response')
    }
  } catch (error) {
    console.error('Error fetching GitHub directory contents:', error)
    return []
  }
}

async function walkGitHubDir(
  owner: string,
  repo: string,
  path: string,
  parentPath?: string
): Promise<WalkEntry[]> {
  const fileLinks = await fetchGitHubDirectoryContents(owner, repo, path)

  const recursiveFiles = await Promise.all(
    fileLinks.map(async (fileLink) => {
      if (fileLink.type === 'dir') {
        return walkGitHubDir(owner, repo, fileLink.path, path)
      } else if (
        fileLink.type === 'file' &&
        (fileLink.name.endsWith('.mdx') || fileLink.name.endsWith('.md'))
      ) {
        return [
          {
            path: fileLink.download_url,
            parentPath: parentPath,
          },
        ] as WalkEntry[]
      }
      return []
    })
  )

  const flattenedFiles = recursiveFiles.reduce(
    (all, folderContents) => all.concat(folderContents),
    []
  )

  return flattenedFiles.sort((a, b) => a.path.localeCompare(b.path))
}

abstract class BaseEmbeddingSource {
  checksum?: string
  meta?: Meta
  sections?: Section[]

  constructor(
    public source: string,
    public path: string,
    public parentPath?: string
  ) {}

  abstract load(): Promise<{
    checksum: string
    meta?: Meta
    sections: Section[]
  }>
}

class MarkdownEmbeddingSource extends BaseEmbeddingSource {
  type: 'markdown' = 'markdown'

  constructor(
    source: string,
    public filePath: string,
    public parentFilePath?: string
  ) {
    const path = filePath.replace(/^pages/, '').replace(/\.mdx?$/, '')
    const parentPath = parentFilePath?.replace(/^pages/, '').replace(/\.mdx?$/, '')

    super(source, path, parentPath)
  }

  async load() {
    try {
      const response = await fetch(this.filePath)
      const fileContent = await response.text()

      //TODO: handle unsanitzied markdown gracefully
      const { checksum, meta, sections } = processMdxForSearch(fileContent)

      this.checksum = checksum
      this.meta = meta
      this.sections = sections

      return {
        checksum,
        meta,
        sections,
      }
    } catch (error) {
      console.error(`Error fetching file contents for this path: ${this.filePath}`, error)
      return {
        checksum: '',
        meta: undefined,
        sections: [],
      }
    }
  }
}

type EmbeddingSource = MarkdownEmbeddingSource

async function generateEmbeddings() {
  const argv = await yargs.option('refresh', {
    alias: 'r',
    description: 'Refresh data',
    type: 'boolean',
  }).argv

  const shouldRefresh = argv.refresh

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.OPENAI_KEY
  ) {
    return console.log(
      'Environment variables NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENAI_KEY are required: skipping embeddings generation'
    )
  }

  const supabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
  // Seeded data for testing
  const parsedGhUrl = parseGitHubURL('https://github.com/pmndrs/zustand/tree/main/docs')

  if (!parsedGhUrl) {
    return
  }

  const { owner, repo, path } = parsedGhUrl

  // Generate EmbeddingSources by walking through the 'pages' directory
  // Filter out non-MDX files and ignored files
  // Create a new MarkdownEmbeddingSource for each valid file
  const fileLinks = await walkGitHubDir(owner, repo, path)

  const embeddingSources: EmbeddingSource[] = fileLinks
    .filter(({ path }) => !ignoredFiles.includes(path))
    .map((entry) => new MarkdownEmbeddingSource('guide', entry.path))

  console.log(`Discovered ${embeddingSources.length} pages`)
  console.log(embeddingSources.map(({ path }) => path))
  // If the refresh flag is not set, we only check for new or changed pages.
  // If the refresh flag is set, we re-generate all pages regardless of changes.
  if (!shouldRefresh) {
    console.log('Checking which pages are new or have changed')
  } else {
    console.log('Refresh flag set, re-generating all pages')
  }

  let project_id: number

  // Query the Supabase database for a project with the given name
  const { error: fetchProjectError, data: projectPage } = await supabaseClient
    .from('projects')
    .select('id, name')
    .filter('name', 'eq', `${owner}/${repo}/${path}`)
    .limit(1)
    .maybeSingle()

  // If there was an error fetching the project or no project was found, create a new project
  if (fetchProjectError || !projectPage) {
    const { error: createProjectError } = await supabaseClient.from('projects').insert({
      name: `${owner}/${repo}/${path}`,
    })
    if (createProjectError || !projectPage) {
      throw createProjectError
    }
    project_id = projectPage.id
  }

  // Assign the project ID to the variable and log it to the console
  project_id = projectPage.id

  console.log('Assigning to project id: ', project_id)

  for (const embeddingSource of embeddingSources) {
    const { type, source, path, parentPath } = embeddingSource

    try {
      // Loop through each embedding source. For each source, we extract its type, source, path, and parentPath.
      // TODO: fetch Github .md files that are in embeddingSources
      // TODO: maybe fetch .md files in parallel before this
      const { checksum, meta, sections } = await embeddingSource.load()

      // Check for existing page in DB and compare checksums
      const { error: fetchPageError, data: existingPage } = await supabaseClient
        .from('nods_page')
        .select('id, path, checksum, parentPage:parent_page_id(id, path)')
        .filter('path', 'eq', path)
        .limit(1)
        .maybeSingle()

      if (fetchPageError) {
        throw fetchPageError
      }

      // We use checksum to determine if this page & its sections need to be regenerated
      if (!shouldRefresh && existingPage?.checksum === checksum) {
        const existingParentPage = Array.isArray(existingPage?.parentPage)
          ? existingPage.parentPage[0]
          : existingPage?.parentPage

        // If parent page changed, update it
        if (existingParentPage?.path !== parentPath) {
          console.log(`[${path}] Parent page has changed. Updating to '${parentPath}'...`)
          const { error: fetchParentPageError, data: parentPage } = await supabaseClient
            .from('nods_page')
            .select()
            .filter('path', 'eq', parentPath)
            .limit(1)
            .maybeSingle()

          if (fetchParentPageError) {
            throw fetchParentPageError
          }

          const { error: updatePageError } = await supabaseClient
            .from('nods_page')
            .update({ parent_page_id: parentPage?.id })
            .filter('id', 'eq', existingPage.id)

          if (updatePageError) {
            throw updatePageError
          }
        }
        continue
      }

      // If the page exists, we remove old page sections and their embeddings.
      if (existingPage) {
        if (!shouldRefresh) {
          console.log(
            `[${path}] Docs have changed, removing old page sections and their embeddings`
          )
        } else {
          console.log(`[${path}] Refresh flag set, removing old page sections and their embeddings`)
        }

        const { error: deletePageSectionError } = await supabaseClient
          .from('nods_page_section')
          .delete()
          .filter('page_id', 'eq', existingPage.id)

        if (deletePageSectionError) {
          throw deletePageSectionError
        }
      }

      const { error: fetchParentPageError, data: parentPage } = await supabaseClient
        .from('nods_page')
        .select()
        .filter('path', 'eq', parentPath)
        .limit(1)
        .maybeSingle()

      if (fetchParentPageError) {
        throw fetchParentPageError
      }

      // Create/update page record. Intentionally clear checksum until we
      // have successfully generated all page sections.
      const { error: upsertPageError, data: page } = await supabaseClient
        .from('nods_page')
        .upsert(
          {
            checksum: null,
            path,
            type,
            source,
            meta,
            parent_page_id: parentPage?.id,
            project_id,
          },
          { onConflict: 'path' }
        )
        .select()
        .limit(1)
        .single()

      if (upsertPageError) {
        throw upsertPageError
      }

      console.log(`[${path}] Adding ${sections.length} page sections (with embeddings)`)
      // This for loop iterates over each section of the current page.
      // For each section, it generates an embedding using OpenAI's API,
      // then inserts the section along with its embedding into the database.
      for (const { slug, heading, content } of sections) {
        // OpenAI recommends replacing newlines with spaces for best results (specific to embeddings)
        const input = content.replace(/\n/g, ' ')

        try {
          const configuration = new Configuration({
            apiKey: process.env.OPENAI_KEY,
          })
          const openai = new OpenAIApi(configuration)

          const embeddingResponse = await openai.createEmbedding({
            model: 'text-embedding-ada-002',
            input,
          })

          if (embeddingResponse.status !== 200) {
            throw new Error(inspect(embeddingResponse.data, false, 2))
          }

          const [responseData] = embeddingResponse.data.data

          const { error: insertPageSectionError, data: pageSection } = await supabaseClient
            .from('nods_page_section')
            // TODO: add a column for what project the file belongs to
            .insert({
              page_id: page.id,
              slug,
              heading,
              content,
              token_count: embeddingResponse.data.usage.total_tokens,
              embedding: responseData.embedding,
            })
            .select()
            .limit(1)
            .single()

          if (insertPageSectionError) {
            throw insertPageSectionError
          }
        } catch (err) {
          // TODO: decide how to better handle failed embeddings
          console.error(
            `Failed to generate embeddings for '${path}' page section starting with '${input.slice(
              0,
              40
            )}...'`
          )

          throw err
        }
      }

      // Set page checksum so that we know this page was stored successfully
      const { error: updatePageError } = await supabaseClient
        .from('nods_page')
        .update({ checksum })
        .filter('id', 'eq', page.id)

      if (updatePageError) {
        throw updatePageError
      }
    } catch (err) {
      console.error(
        `Page '${path}' or one/multiple of its page sections failed to store properly. Page has been marked with null checksum to indicate that it needs to be re-generated.`
      )
      console.error(err)
    }
  }

  console.log('Embedding generation complete')
}

async function main() {
  await generateEmbeddings()
}

main().catch((err) => console.error(err))
