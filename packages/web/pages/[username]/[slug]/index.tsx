import { PrimaryLayout } from '../../../components/templates/PrimaryLayout'
import { LoadingView } from '../../../components/patterns/LoadingView'
import { useGetViewerQuery } from '../../../lib/networking/queries/useGetViewerQuery'
import {
  removeItemFromCache,
  useGetArticleQuery,
} from '../../../lib/networking/queries/useGetArticleQuery'
import { useRouter } from 'next/router'
import { VStack } from './../../../components/elements/LayoutPrimitives'
import {
  ArticleContainer,
  UpdateTitleEvent,
} from './../../../components/templates/article/ArticleContainer'
import { PdfArticleContainerProps } from './../../../components/templates/article/PdfArticleContainer'
import { useCallback, useEffect, useState } from 'react'
import { useKeyboardShortcuts } from '../../../lib/keyboardShortcuts/useKeyboardShortcuts'
import { navigationCommands } from '../../../lib/keyboardShortcuts/navigationShortcuts'
import dynamic from 'next/dynamic'
import { Toaster } from 'react-hot-toast'
import { createHighlightMutation } from '../../../lib/networking/mutations/createHighlightMutation'
import { deleteHighlightMutation } from '../../../lib/networking/mutations/deleteHighlightMutation'
import { mergeHighlightMutation } from '../../../lib/networking/mutations/mergeHighlightMutation'
import { articleReadingProgressMutation } from '../../../lib/networking/mutations/articleReadingProgressMutation'
import { updateHighlightMutation } from '../../../lib/networking/mutations/updateHighlightMutation'
import Script from 'next/script'
import { ArticleActionsMenu } from '../../../components/templates/article/ArticleActionsMenu'
import { setLinkArchivedMutation } from '../../../lib/networking/mutations/setLinkArchivedMutation'
import { Label } from '../../../lib/networking/fragments/labelFragment'
import { useSWRConfig } from 'swr'
import { showErrorToast, showSuccessToast } from '../../../lib/toastHelpers'
import { SetLabelsModal } from '../../../components/templates/article/SetLabelsModal'
import { DisplaySettingsModal } from '../../../components/templates/article/DisplaySettingsModal'
import { useReaderSettings } from '../../../lib/hooks/useReaderSettings'
import { SkeletonArticleContainer } from '../../../components/templates/article/SkeletonArticleContainer'
import { useRegisterActions } from 'kbar'
import { deleteLinkMutation } from '../../../lib/networking/mutations/deleteLinkMutation'
import { ConfirmationModal } from '../../../components/patterns/ConfirmationModal'
import { ReaderHeader } from '../../../components/templates/reader/ReaderHeader'
import { EditArticleModal } from '../../../components/templates/homeFeed/EditItemModals'
import { VerticalArticleActionsMenu } from '../../../components/templates/article/VerticalArticleActions'
import { PdfHeaderSpacer } from '../../../components/templates/article/PdfHeaderSpacer'
import { EpubContainerProps } from '../../../components/templates/article/EpubContainer'
import { useSetPageLabels } from '../../../lib/hooks/useSetPageLabels'

const PdfArticleContainerNoSSR = dynamic<PdfArticleContainerProps>(
  () => import('./../../../components/templates/article/PdfArticleContainer'),
  { ssr: false }
)

const EpubContainerNoSSR = dynamic<EpubContainerProps>(
  () => import('./../../../components/templates/article/EpubContainer'),
  { ssr: false }
)

export default function Home(): JSX.Element {
  const router = useRouter()
  const { cache, mutate } = useSWRConfig()
  const [showEditModal, setShowEditModal] = useState(false)
  const [showHighlightsModal, setShowHighlightsModal] = useState(false)
  const { viewerData } = useGetViewerQuery()
  const readerSettings = useReaderSettings()

  const { articleData, articleFetchError } = useGetArticleQuery({
    username: router.query.username as string,
    slug: router.query.slug as string,
    includeFriendsHighlights: false,
  })
  const article = articleData?.article.article
  useEffect(() => {
    dispatchLabels({
      type: 'RESET',
      labels: article?.labels ?? [],
    })
  }, [articleData?.article.article])

  useKeyboardShortcuts(navigationCommands(router))

  const actionHandler = useCallback(
    async (action: string, arg?: unknown) => {
      switch (action) {
        case 'unarchive':
          if (article) {
            removeItemFromCache(cache, mutate, article.id)

            setLinkArchivedMutation({
              linkId: article.id,
              archived: false,
            }).then((res) => {
              if (res) {
                showSuccessToast('Link unarchived', {
                  position: 'bottom-right',
                })
              } else {
                showErrorToast('Error unarchiving link', {
                  position: 'bottom-right',
                })
              }
            })

            router.push(`/home`)
          }
          break
        case 'archive':
          if (article) {
            removeItemFromCache(cache, mutate, article.id)

            await setLinkArchivedMutation({
              linkId: article.id,
              archived: true,
            }).then((res) => {
              if (!res) {
                showErrorToast('Error archiving', {
                  position: 'bottom-right',
                })
              } else {
                router.push(`/home`)
              }
            })
          }
          break
        case 'mark-read':
          if (article) {
            articleReadingProgressMutation({
              id: article.id,
              readingProgressPercent: 100,
              readingProgressTopPercent: 100,
              readingProgressAnchorIndex: 0,
            }).then((res) => {
              if (!res) {
                // todo: revalidate or put back in cache?
                showErrorToast('Error marking as read', {
                  position: 'bottom-right',
                })
              } else {
                router.push(`/home`)
              }
            })
          }
          break
        case 'delete':
          readerSettings.setShowDeleteConfirmation(true)
          break
        case 'openOriginalArticle':
          const url = article?.url
          if (url) {
            window.open(url, '_blank')
          }
          break
        case 'refreshLabels':
          dispatchLabels({
            type: 'RESET',
            labels: arg as Label[],
          })
          break
        case 'showHighlights':
          setShowHighlightsModal(true)
          break
        case 'showEditModal':
          setShowEditModal(true)
          break
        default:
          readerSettings.actionHandler(action, arg)
          break
      }
    },
    [article, cache, mutate, router, readerSettings]
  )

  useEffect(() => {
    const archive = () => {
      actionHandler('archive')
    }
    const openOriginalArticle = () => {
      actionHandler('openOriginalArticle')
    }
    const deletePage = () => {
      actionHandler('delete')
    }

    const markRead = () => {
      actionHandler('mark-read')
    }

    document.addEventListener('archive', archive)
    document.addEventListener('delete', deletePage)
    document.addEventListener('mark-read', markRead)
    document.addEventListener('openOriginalArticle', openOriginalArticle)

    return () => {
      document.removeEventListener('archive', archive)
      document.removeEventListener('mark-read', markRead)
      document.removeEventListener('openOriginalArticle', openOriginalArticle)
    }
  }, [actionHandler])

  useEffect(() => {
    if (article && viewerData?.me) {
      window.analytics?.track('link_read', {
        link: article.id,
        slug: article.slug,
        url: article.originalArticleUrl,
        userId: viewerData.me.id,
      })
    }
  }, [article, viewerData])

  const deleteCurrentItem = useCallback(async () => {
    if (article) {
      removeItemFromCache(cache, mutate, article.id)
      await deleteLinkMutation(article.id).then((res) => {
        if (res) {
          showSuccessToast('Page deleted', { position: 'bottom-right' })
        } else {
          // todo: revalidate or put back in cache?
          showErrorToast('Error deleting page', { position: 'bottom-right' })
        }
      })
      router.push(`/home`)
    }
  }, [article, cache, mutate, router])

  useRegisterActions(
    [
      {
        id: 'open',
        section: 'Article',
        name: 'Open original article',
        shortcut: ['o'],
        perform: () => {
          document.dispatchEvent(new Event('openOriginalArticle'))
        },
      },
      {
        id: 'back_home',
        section: 'Article',
        name: 'Return to library',
        shortcut: ['u'],
        perform: () => {
          const query = window.sessionStorage.getItem('q')
          if (query) {
            router.push(`/home?${query}`)
            return
          } else {
            router.push(`/home`)
          }
        },
      },
      {
        id: 'back_home_esc',
        section: 'Article',
        name: 'Back to library',
        shortcut: ['escape'],
        perform: () => {
          if (
            readerSettings.showSetLabelsModal ||
            readerSettings.showDeleteConfirmation ||
            readerSettings.showDeleteConfirmation ||
            readerSettings.showEditDisplaySettingsModal
          ) {
            return
          }
          if (showHighlightsModal) {
            setShowHighlightsModal(false)
            return
          }
          const query = window.sessionStorage.getItem('q')
          if (query) {
            router.push(`/home?${query}`)
            return
          } else {
            router.push(`/home`)
          }
        },
      },
      {
        id: 'archive',
        section: 'Article',
        name: 'Archive current item',
        shortcut: ['e'],
        perform: () => {
          document.dispatchEvent(new Event('archive'))
        },
      },
      {
        id: 'mark_read',
        section: 'Article',
        name: 'Mark current item as read',
        shortcut: ['m', 'r'],
        perform: () => {
          document.dispatchEvent(new Event('mark-read'))
        },
      },
      {
        id: 'full_screen',
        section: 'Article',
        name: 'Read fullscreen',
        shortcut: ['f'],
        perform: () => {
          const reader = document.getElementById('article-wrapper')
          if (!reader) {
            alert('Unable to enter fullscreen mode')
          }
          reader?.requestFullscreen()
        },
      },
      {
        id: 'delete',
        section: 'Article',
        name: 'Delete current item',
        shortcut: ['#'],
        perform: () => {
          document.dispatchEvent(new Event('delete'))
        },
      },
      {
        id: 'highlight',
        section: 'Article',
        name: 'Highlight selected text',
        shortcut: ['h'],
        perform: () => {
          document.dispatchEvent(new Event('highlight'))
        },
      },
      {
        id: 'highlight_next',
        section: 'Article',
        name: 'Scroll to next highlight',
        shortcut: ['j'],
        perform: () => {
          document.dispatchEvent(new Event('scrollToNextHighlight'))
        },
      },
      {
        id: 'highlight_previous',
        section: 'Article',
        name: 'Scroll to previous highlight',
        shortcut: ['k'],
        perform: () => {
          document.dispatchEvent(new Event('scrollToPrevHighlight'))
        },
      },
      {
        id: 'note',
        section: 'Article',
        name: 'Highlight selected text and add a note',
        shortcut: ['n'],
        perform: () => {
          document.dispatchEvent(new Event('annotate'))
        },
      },
      {
        id: 'notebook',
        section: 'Article',
        name: 'Notebook',
        shortcut: ['t'],
        perform: () => {
          setShowHighlightsModal(!showHighlightsModal)
        },
      },
      {
        id: 'edit_title',
        section: 'Article',
        name: 'Edit Info',
        shortcut: ['i'],
        perform: () => setShowEditModal(true),
      },
    ],
    [readerSettings, showHighlightsModal]
  )

  const [labels, dispatchLabels] = useSetPageLabels(
    articleData?.article.article?.id
  )

  if (articleFetchError && articleFetchError.indexOf('NOT_FOUND') > -1) {
    router.push('/404')
    return <LoadingView />
  }

  return (
    <PrimaryLayout
      pageTestId="home-page-tag"
      headerToolbarControl={
        <ArticleActionsMenu
          article={article}
          layout="top"
          showReaderDisplaySettings={article?.contentReader != 'PDF'}
          readerSettings={readerSettings}
          articleActionHandler={actionHandler}
        />
      }
      alwaysDisplayToolbar={article?.contentReader == 'PDF'}
      pageMetaDataProps={{
        title: article?.title ?? '',
        path: router.pathname,
        description: article?.description ?? '',
      }}
    >
      <Script async src="/static/scripts/mathJaxConfiguration.js" />
      <Script
        async
        id="MathJax-script"
        src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"
      />
      <Toaster />

      <ReaderHeader
        hideDisplaySettings={false}
        showDisplaySettingsModal={
          readerSettings.setShowEditDisplaySettingsModal
        }
        alwaysDisplayToolbar={article?.contentReader == 'PDF'}
      >
        <VerticalArticleActionsMenu
          article={article}
          layout="top"
          showReaderDisplaySettings={article?.contentReader != 'PDF'}
          articleActionHandler={actionHandler}
        />
      </ReaderHeader>

      {article?.contentReader == 'PDF' && <PdfHeaderSpacer />}

      <VStack
        distribution="between"
        alignment="center"
        css={{
          position: 'fixed',
          flexDirection: 'row-reverse',
          left: 8,
          height: '100%',
          width: '35px',
          '@lgDown': {
            display: 'none',
          },
        }}
      >
        {article?.contentReader !== 'PDF' ? (
          <ArticleActionsMenu
            article={article}
            layout="side"
            readerSettings={readerSettings}
            showReaderDisplaySettings={true}
            articleActionHandler={actionHandler}
          />
        ) : null}
      </VStack>
      {article && viewerData?.me && article.contentReader == 'PDF' && (
        <PdfArticleContainerNoSSR
          article={article}
          showHighlightsModal={showHighlightsModal}
          setShowHighlightsModal={setShowHighlightsModal}
          viewer={viewerData.me}
        />
      )}
      {article && viewerData?.me && article.contentReader == 'WEB' && (
        <VStack
          id="article-wrapper"
          alignment="center"
          distribution="start"
          className="disable-webkit-callout"
          css={{
            width: '100%',
            height: '100%',
            background: '$readerMargin',
            overflow: 'scroll',
            paddingTop: '80px',
            '@media print': {
              paddingTop: '0px',
            },
          }}
        >
          {article && viewerData?.me ? (
            <ArticleContainer
              viewer={viewerData.me}
              article={article}
              isAppleAppEmbed={false}
              highlightBarDisabled={false}
              fontSize={readerSettings.fontSize}
              margin={readerSettings.marginWidth}
              lineHeight={readerSettings.lineHeight}
              fontFamily={readerSettings.fontFamily}
              labels={labels.labels}
              showHighlightsModal={showHighlightsModal}
              setShowHighlightsModal={setShowHighlightsModal}
              justifyText={readerSettings.justifyText ?? undefined}
              highContrastText={readerSettings.highContrastText ?? undefined}
              articleMutations={{
                createHighlightMutation,
                deleteHighlightMutation,
                mergeHighlightMutation,
                updateHighlightMutation,
                articleReadingProgressMutation,
              }}
            />
          ) : (
            <SkeletonArticleContainer
              margin={readerSettings.marginWidth}
              lineHeight={readerSettings.lineHeight}
              fontSize={readerSettings.fontSize}
            />
          )}
        </VStack>
      )}

      {article && viewerData?.me && article.contentReader == 'EPUB' && (
        <VStack
          alignment="center"
          distribution="start"
          className="disable-webkit-callout"
          css={{
            width: '100%',
            height: '100%',
            background: '$readerMargin',
            overflow: 'scroll',
            paddingTop: '80px',
          }}
        >
          {article && viewerData?.me ? (
            <EpubContainerNoSSR
              article={article}
              showHighlightsModal={showHighlightsModal}
              setShowHighlightsModal={setShowHighlightsModal}
              viewer={viewerData.me}
            />
          ) : (
            <SkeletonArticleContainer
              margin={readerSettings.marginWidth}
              lineHeight={readerSettings.lineHeight}
              fontSize={readerSettings.fontSize}
            />
          )}
        </VStack>
      )}

      {article && readerSettings.showSetLabelsModal && (
        <SetLabelsModal
          provider={article}
          selectedLabels={labels.labels}
          dispatchLabels={dispatchLabels}
          onOpenChange={() => readerSettings.setShowSetLabelsModal(false)}
        />
      )}
      {readerSettings.showEditDisplaySettingsModal && (
        <DisplaySettingsModal
          centerX={true}
          readerSettings={readerSettings}
          onOpenChange={() => {
            readerSettings.setShowEditDisplaySettingsModal(false)
          }}
        />
      )}
      {readerSettings.showDeleteConfirmation && (
        <ConfirmationModal
          message={'Are you sure you want to delete this page?'}
          onAccept={deleteCurrentItem}
          onOpenChange={() => readerSettings.setShowDeleteConfirmation(false)}
        />
      )}
      {article && showEditModal && (
        <EditArticleModal
          article={article}
          onOpenChange={() => setShowEditModal(false)}
          updateArticle={(title, author, description, savedAt, publishedAt) => {
            article.title = title
            article.author = author
            article.description = description
            article.savedAt = savedAt
            article.publishedAt = publishedAt

            const titleEvent = new Event('updateTitle') as UpdateTitleEvent
            titleEvent.title = title
            document.dispatchEvent(titleEvent)
          }}
        />
      )}
    </PrimaryLayout>
  )
}
