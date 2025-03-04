/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
// Imports the Google Cloud Tasks library.
import { CloudTasksClient, protos } from '@google-cloud/tasks'
import { google } from '@google-cloud/tasks/build/protos/protos'
import axios from 'axios'
import { nanoid } from 'nanoid'
import { Recommendation } from '../elastic/types'
import { Subscription } from '../entity/subscription'
import { env } from '../env'
import {
  ArticleSavingRequestStatus,
  CreateLabelInput,
} from '../generated/graphql'
import { signFeatureToken } from '../services/features'
import { generateVerificationToken, OmnivoreAuthorizationHeader } from './auth'
import { CreateTaskError } from './errors'
import { buildLogger } from './logger'
import View = google.cloud.tasks.v2.Task.View

const logger = buildLogger('app.dispatch')

// Instantiates a client.
const client = new CloudTasksClient()

const createHttpTaskWithToken = async ({
  project = process.env.GOOGLE_CLOUD_PROJECT,
  queue = env.queue.name,
  location = env.queue.location,
  taskHandlerUrl = env.queue.contentFetchUrl,
  serviceAccountEmail = `${process.env.GOOGLE_CLOUD_PROJECT}@appspot.gserviceaccount.com`,
  payload,
  priority = 'high',
  scheduleTime,
  requestHeaders,
}: {
  project?: string
  queue?: string
  location?: string
  taskHandlerUrl?: string
  serviceAccountEmail?: string
  payload: unknown
  priority?: 'low' | 'high'
  scheduleTime?: number
  requestHeaders?: Record<string, string>
}): Promise<
  | [
      protos.google.cloud.tasks.v2.ITask,
      protos.google.cloud.tasks.v2.ICreateTaskRequest | undefined,
      unknown | undefined
    ]
  | null
> => {
  // If there is no Google Cloud Project Id exposed, it means that we are in local environment
  if (env.dev.isLocal || !project) {
    return null
  }

  // Construct the fully qualified queue name.
  if (priority === 'low') {
    queue = `${queue}-low`
  }

  const parent = client.queuePath(project, location, queue)
  // Convert message to buffer.
  let convertedPayload: string | ArrayBuffer
  try {
    convertedPayload = JSON.stringify(payload)
  } catch (error) {
    throw new CreateTaskError('Invalid payload')
  }
  const body = Buffer.from(convertedPayload).toString('base64')

  const task: protos.google.cloud.tasks.v2.ITask = {
    httpRequest: {
      httpMethod: 'POST',
      url: taskHandlerUrl,
      headers: {
        'Content-Type': 'application/json',
        ...requestHeaders,
      },
      body,
      ...(serviceAccountEmail
        ? {
            oidcToken: {
              serviceAccountEmail,
            },
          }
        : null),
    },
    scheduleTime: scheduleTime
      ? protos.google.protobuf.Timestamp.fromObject({
          seconds: scheduleTime / 1000,
          nanos: (scheduleTime % 1000) * 1e6,
        })
      : null,
  }

  return client.createTask({ parent, task })
}

export const createAppEngineTask = async ({
  project,
  queue = env.queue.name,
  location = env.queue.location,
  taskHandlerUrl = env.queue.reminderTaskHandlerUrl,
  payload,
  priority = 'high',
  scheduleTime,
}: {
  project: string
  queue?: string
  location?: string
  taskHandlerUrl?: string
  payload: unknown
  priority?: 'low' | 'high'
  scheduleTime?: number
}): Promise<string | undefined | null> => {
  // Construct the fully qualified queue name.
  if (priority === 'low') {
    queue = `${queue}-low`
  }

  const parent = client.queuePath(project, location, queue)
  const task: protos.google.cloud.tasks.v2.ITask = {
    appEngineHttpRequest: {
      httpMethod: 'POST',
      relativeUri: taskHandlerUrl,
    },
  }

  if (payload && task.appEngineHttpRequest) {
    // Convert message to buffer.
    let convertedPayload: string | ArrayBuffer
    try {
      convertedPayload = JSON.stringify(payload)
    } catch (error) {
      throw new CreateTaskError('Invalid payload')
    }

    task.appEngineHttpRequest.body =
      Buffer.from(convertedPayload).toString('base64')
  }

  if (scheduleTime) {
    // The time when the task is scheduled to be attempted.
    task.scheduleTime = {
      seconds: scheduleTime / 1000,
    }
  }

  console.log('Sending task:')
  console.log(task)
  // Send create task request.
  const request = { parent: parent, task: task }
  const [response] = await client.createTask(request)
  const name = response.name
  console.log(`Created task ${name}`)

  return name
}

export const getTask = async (
  taskName: string
): Promise<google.cloud.tasks.v2.ITask> => {
  // If we are in local environment
  if (env.dev.isLocal) {
    return { name: taskName } as protos.google.cloud.tasks.v2.ITask
  }

  const request: protos.google.cloud.tasks.v2.GetTaskRequest = {
    responseView: View.FULL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toJSON(): { [p: string]: any } {
      return {}
    },
    name: taskName,
  }

  const [response] = await client.getTask(request)

  return response
}

export const deleteTask = async (
  taskName: string
): Promise<google.protobuf.IEmpty> => {
  // If we are in local environment
  if (env.dev.isLocal) {
    return taskName
  }

  const request: protos.google.cloud.tasks.v2.IDeleteTaskRequest = {
    name: taskName,
  }

  const [response] = await client.deleteTask(request)

  return response
}

/**
 * Enqueues the task for the article content parsing with Puppeteer by URL
 * @param url - URL address of the article to parse
 * @param userId - Id of the user authorized
 * @param saveRequestId - Id of the article_saving_request table record
 * @param priority - Priority of the task
 * @param queue - Queue name
 * @returns Name of the task created
 */
export const enqueueParseRequest = async ({
  url,
  userId,
  saveRequestId,
  priority = 'high',
  queue = env.queue.name,
  state,
  labels,
  locale,
  timezone,
}: {
  url: string
  userId: string
  saveRequestId: string
  priority?: 'low' | 'high'
  queue?: string
  state?: ArticleSavingRequestStatus
  labels?: CreateLabelInput[]
  locale?: string
  timezone?: string
}): Promise<string> => {
  const { GOOGLE_CLOUD_PROJECT } = process.env
  const payload = {
    url,
    userId,
    saveRequestId,
    state,
    labels,
    locale,
    timezone,
  }

  // If there is no Google Cloud Project Id exposed, it means that we are in local environment
  if (env.dev.isLocal || !GOOGLE_CLOUD_PROJECT) {
    // Calling the handler function directly.
    setTimeout(() => {
      axios.post(env.queue.contentFetchUrl, payload).catch((error) => {
        console.error(error)
        logger.warning(
          `Error occurred while requesting local puppeteer-parse function\nPlease, ensure your function is set up properly and running using "yarn start" from the "/pkg/gcf/puppeteer-parse" folder`
        )
      })
    }, 0)
    return ''
  }

  // use GCF url for low priority tasks
  const taskHandlerUrl =
    priority === 'low'
      ? env.queue.contentFetchGCFUrl
      : env.queue.contentFetchUrl

  const createdTasks = await createHttpTaskWithToken({
    project: GOOGLE_CLOUD_PROJECT,
    payload,
    priority,
    taskHandlerUrl,
    queue,
  })
  if (!createdTasks || !createdTasks[0].name) {
    logger.error(`Unable to get the name of the task`, {
      payload,
      createdTasks,
    })
    throw new CreateTaskError(`Unable to get the name of the task`)
  }
  return createdTasks[0].name
}

export const enqueueReminder = async (
  userId: string,
  scheduleTime: number
): Promise<string> => {
  const { GOOGLE_CLOUD_PROJECT } = process.env
  const payload = {
    userId,
    scheduleTime,
  }

  // If there is no Google Cloud Project Id exposed, it means that we are in local environment
  if (env.dev.isLocal || !GOOGLE_CLOUD_PROJECT) {
    return nanoid()
  }

  const createdTasks = await createHttpTaskWithToken({
    project: GOOGLE_CLOUD_PROJECT,
    payload,
    scheduleTime,
    taskHandlerUrl: env.queue.reminderTaskHandlerUrl,
  })

  if (!createdTasks || !createdTasks[0].name) {
    logger.error(`Unable to get the name of the task`, {
      payload,
      createdTasks,
    })
    throw new CreateTaskError(`Unable to get the name of the task`)
  }
  return createdTasks[0].name
}

export const enqueueSyncWithIntegration = async (
  userId: string,
  integrationName: string
): Promise<string> => {
  const { GOOGLE_CLOUD_PROJECT, PUBSUB_VERIFICATION_TOKEN } = process.env
  // use pubsub data format to send the userId to the task handler
  const payload = {
    message: {
      data: Buffer.from(
        JSON.stringify({
          userId,
        })
      ).toString('base64'),
      publishTime: new Date().toISOString(),
    },
  }

  // If there is no Google Cloud Project Id exposed, it means that we are in local environment
  if (env.dev.isLocal || !GOOGLE_CLOUD_PROJECT) {
    return nanoid()
  }

  const createdTasks = await createHttpTaskWithToken({
    project: GOOGLE_CLOUD_PROJECT,
    payload,
    taskHandlerUrl: `${
      env.queue.integrationTaskHandlerUrl
    }/${integrationName.toLowerCase()}/sync_all?token=${PUBSUB_VERIFICATION_TOKEN}`,
    priority: 'low',
  })

  if (!createdTasks || !createdTasks[0].name) {
    logger.error(`Unable to get the name of the task`, {
      payload,
      createdTasks,
    })
    throw new CreateTaskError(`Unable to get the name of the task`)
  }
  return createdTasks[0].name
}

export const enqueueTextToSpeech = async ({
  userId,
  text,
  speechId,
  voice,
  priority,
  textType = 'ssml',
  bucket = env.fileUpload.gcsUploadBucket,
  queue = 'omnivore-text-to-speech-queue',
  location = env.gcp.location,
  isUltraRealisticVoice = false,
  language,
  rate,
  featureName,
  grantedAt,
}: {
  userId: string
  speechId: string
  text: string
  voice: string
  priority: 'low' | 'high'
  bucket?: string
  textType?: 'text' | 'ssml'
  queue?: string
  location?: string
  isUltraRealisticVoice?: boolean
  language?: string
  rate?: string
  featureName?: string
  grantedAt?: Date | null
}): Promise<string> => {
  const { GOOGLE_CLOUD_PROJECT } = process.env
  const payload = {
    id: speechId,
    text,
    voice,
    bucket,
    textType,
    isUltraRealisticVoice,
    language,
    rate,
  }
  const token = signFeatureToken({ name: featureName, grantedAt }, userId)
  const taskHandlerUrl = `${env.queue.textToSpeechTaskHandlerUrl}?token=${token}`
  // If there is no Google Cloud Project Id exposed, it means that we are in local environment
  if (env.dev.isLocal || !GOOGLE_CLOUD_PROJECT) {
    // Calling the handler function directly.
    setTimeout(() => {
      axios.post(taskHandlerUrl, payload).catch((error) => {
        logger.error(error)
      })
    }, 0)
    return ''
  }
  const createdTasks = await createHttpTaskWithToken({
    project: GOOGLE_CLOUD_PROJECT,
    payload,
    taskHandlerUrl,
    queue,
    location,
    priority,
  })

  if (!createdTasks || !createdTasks[0].name) {
    logger.error(`Unable to get the name of the task`, {
      payload,
      createdTasks,
    })
    throw new CreateTaskError(`Unable to get the name of the task`)
  }
  return createdTasks[0].name
}

export const enqueueRecommendation = async (
  userId: string,
  pageId: string,
  recommendation: Recommendation,
  authToken: string,
  highlightIds?: string[]
): Promise<string> => {
  const { GOOGLE_CLOUD_PROJECT } = process.env
  const payload = {
    userId,
    pageId,
    recommendation,
    highlightIds,
  }

  const headers = {
    [OmnivoreAuthorizationHeader]: authToken,
  }
  // If there is no Google Cloud Project Id exposed, it means that we are in local environment
  if (env.dev.isLocal || !GOOGLE_CLOUD_PROJECT) {
    // Calling the handler function directly.
    setTimeout(() => {
      axios
        .post(env.queue.recommendationTaskHandlerUrl, payload, {
          headers,
        })
        .catch((error) => {
          logger.error(error)
        })
    }, 0)
    return ''
  }

  const createdTasks = await createHttpTaskWithToken({
    project: GOOGLE_CLOUD_PROJECT,
    payload,
    taskHandlerUrl: env.queue.recommendationTaskHandlerUrl,
    requestHeaders: headers,
  })

  if (!createdTasks || !createdTasks[0].name) {
    logger.error(`Unable to get the name of the task`, {
      payload,
      createdTasks,
    })
    throw new CreateTaskError(`Unable to get the name of the task`)
  }
  return createdTasks[0].name
}

export const enqueueImportFromIntegration = async (
  integrationId: string,
  authToken: string
): Promise<string> => {
  const { GOOGLE_CLOUD_PROJECT } = process.env
  const payload = {
    integrationId,
  }

  const headers = {
    Cookie: `auth=${authToken}`,
  }
  // If there is no Google Cloud Project Id exposed, it means that we are in local environment
  if (env.dev.isLocal || !GOOGLE_CLOUD_PROJECT) {
    // Calling the handler function directly.
    setTimeout(() => {
      axios
        .post(`${env.queue.integrationTaskHandlerUrl}/import`, payload, {
          headers,
        })
        .catch((error) => {
          console.error(error)
        })
    }, 0)
    return nanoid()
  }

  const createdTasks = await createHttpTaskWithToken({
    project: GOOGLE_CLOUD_PROJECT,
    payload,
    taskHandlerUrl: `${env.queue.integrationTaskHandlerUrl}/import`,
    priority: 'low',
    requestHeaders: headers,
  })

  if (!createdTasks || !createdTasks[0].name) {
    logger.error(`Unable to get the name of the task`, {
      payload,
      createdTasks,
    })
    throw new CreateTaskError(`Unable to get the name of the task`)
  }
  return createdTasks[0].name
}

export const enqueueThumbnailTask = async (
  userId: string,
  slug: string,
  content: string
): Promise<string> => {
  const { GOOGLE_CLOUD_PROJECT } = process.env
  const payload = {
    userId,
    slug,
    content,
  }

  const headers = {
    Cookie: `auth=${generateVerificationToken(userId)}`,
  }

  // If there is no Google Cloud Project Id exposed, it means that we are in local environment
  if (env.dev.isLocal || !GOOGLE_CLOUD_PROJECT) {
    // Calling the handler function directly.
    setTimeout(() => {
      axios
        .post(env.queue.thumbnailTaskHandlerUrl, payload, {
          headers,
        })
        .catch((error) => {
          console.error(error)
        })
    }, 0)
    return ''
  }

  const createdTasks = await createHttpTaskWithToken({
    payload,
    taskHandlerUrl: env.queue.thumbnailTaskHandlerUrl,
    requestHeaders: headers,
    queue: 'omnivore-thumbnail-queue',
  })

  if (!createdTasks || !createdTasks[0].name) {
    logger.error(`Unable to get the name of the task`, {
      payload,
      createdTasks,
    })
    throw new CreateTaskError(`Unable to get the name of the task`)
  }
  return createdTasks[0].name
}

export const enqueueRssFeedFetch = async (
  rssFeedSubscription: Subscription
): Promise<string> => {
  const { GOOGLE_CLOUD_PROJECT } = process.env
  const payload = {
    subscriptionId: rssFeedSubscription.id,
    feedUrl: rssFeedSubscription.url,
    lastFetchedAt: rssFeedSubscription.lastFetchedAt?.getTime() || 0, // unix timestamp in milliseconds
  }

  const headers = {
    [OmnivoreAuthorizationHeader]: generateVerificationToken(
      rssFeedSubscription.user.id
    ),
  }

  // If there is no Google Cloud Project Id exposed, it means that we are in local environment
  if (env.dev.isLocal || !GOOGLE_CLOUD_PROJECT) {
    // Calling the handler function directly.
    setTimeout(() => {
      axios
        .post(env.queue.rssFeedTaskHandlerUrl, payload, {
          headers,
        })
        .catch((error) => {
          console.error(error)
        })
    }, 0)
    return nanoid()
  }

  const createdTasks = await createHttpTaskWithToken({
    project: GOOGLE_CLOUD_PROJECT,
    queue: 'omnivore-rss-queue',
    payload,
    taskHandlerUrl: env.queue.rssFeedTaskHandlerUrl,
    requestHeaders: headers,
  })

  if (!createdTasks || !createdTasks[0].name) {
    logger.error(`Unable to get the name of the task`, {
      payload,
      createdTasks,
    })
    throw new CreateTaskError(`Unable to get the name of the task`)
  }
  return createdTasks[0].name
}

export default createHttpTaskWithToken
