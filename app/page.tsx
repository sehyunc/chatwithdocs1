import React from 'react'
import { SearchDialog } from '@/components/SearchDialog'
import styles from '@/styles/Home.module.css'

export const runtime = 'edge'

const Page = () => {
  return (
    <main className={styles.main}>
      <div className={styles.center}>
        <SearchDialog />
      </div>
    </main>
  )
}

export default Page
