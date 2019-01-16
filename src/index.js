process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://b0044b1751f54dfeb75938902f360675:806f25ddaa154985874854c9839ea392@sentry.cozycloud.cc/58'

const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const moment = require('moment')
const request = requestFactory({
  cheerio: true,
  json: false,
  jar: true
})

const baseUrl = 'https://www.digitick.com'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/index-css4-digitick-pg1101-solde1.html`)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    identifiers: ['digitick']
  })
}

function authenticate(tel, passwd) {
  return signin({
    url: `${baseUrl}/user/login`,
    formSelector: '#contenuformulaire form',
    formData: { tel, passwd },
    validate: (statusCode, $) => {
      if ($('#contenuformulaire form').length === 0) {
        return true
      } else {
        log('error', $('.error').text())
        return false
      }
    }
  })
}

function parseDocuments($) {
  const docs = scrape(
    $,
    {
      eventname: {
        sel: 'tbody tr:nth-child(3) td dl dd span:nth-child(1)'
      },
      eventdate: {
        sel: 'tbody tr:nth-child(3) td dl dd span:nth-child(2)'
      },
      eventplace: {
        sel: 'tbody tr:nth-child(3) td dl dd span:nth-child(3)'
      },
      invoicename: {
        sel: 'tbody tr:nth-child(1) th span:nth-child(1)'
      },
      fileurl: {
        sel: 'tbody tr:nth-child(1) th a',
        attr: 'href'
      },
      amount: {
        sel: 'tbody tr:nth-child(1) th span:nth-child(6)'
      },
      date: {
        sel: 'tbody tr:nth-child(1) th span:nth-child(2)'
      }
    },
    '#contentTransaction table'
  )
  return docs.map(
    ({
      invoicename,
      fileurl,
      amount,
      date,
      eventname,
      eventdate,
      eventplace
    }) => ({
      invoicename,
      fileurl,
      event: {
        name: eventname,
        date: parseToDate(eventdate, 'DD/MM/YYYY � HH:mm'),
        place: eventplace
      },
      date: parseToDate(date, 'DD/MM/YYYY - HH:mm'),
      currency: '€',
      vendor: 'template',
      metadata: {
        importDate: new Date(),
        version: 1
      },
      amount: getAmount(amount)
    })
  )
}

function parseToDate(date, format) {
  return moment(date, format).toDate()
}

function getAmount(amount) {
  return parseFloat(/\d+/g.exec(amount).pop())
}
