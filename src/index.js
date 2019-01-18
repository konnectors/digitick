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
  const $ = await request(`${baseUrl}/user/orders`)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    identifiers: ['digitick']
  })
}

function authenticate(email, passwd) {
  return signin({
    url: `${baseUrl}/user/login`,
    formSelector: 'form[action="/login/st"]',
    formData: { "User.Email": email, "Password": passwd },
    validate: (statusCode, $) => {
      if ($('.field-validation-error').length === 0) {
        return true
      }
      else {
        log('error', $('.field-validation-error').text())
        return false
      }
    }
  })
}

async function parseDocuments($) {
  var docs = []

  // Open each event link to retreive informations about order
  const events = $('li', '#user-order-list ul.customer-order-list').toArray()
  for (var i = 0; i < events.length; i++) {
    const link = baseUrl + $('a.g-blocklist-link.view-order-link', events[i]).attr('href')
    const $doc = await request(link)

    const doc = scrape(
      $doc('body'),
      {
        vendorRef: {
          sel: 'header h2',
          parse: parseVendorRef
        },
        eventlabel: {
          sel: 'strong.g-order-summary-top-title'
        },
        eventdate: {
          sel: 'span.pv-sharedreponsive-connected-event-time',
        },
        date: {
          sel: '.g-ui-box-content p:first-child:not(.g-order-summary-top)',
          parse: parseDate
        },
        stringDate: {
          sel: '.g-ui-box-content p:first-child:not(.g-order-summary-top)',
        },
        amount: {
          sel: '#jsOrderTotal',
          parse: getAmount
        },
        stringAmount: {
          sel: '#jsOrderTotal',
          parse: parseStringAmount
        },
        customerName: {
          sel: '.cs-order-address-customer-name',
          parse: parseName
        },
        customerAddress: {
          sel: '.cs-order-address-customer-address',
          parse: parseAddress
        },
      }
    )
  }

  return docs.map(
    ({
      amount,
      date,
    }) => ({
      date,
      currency: '€',
      vendor: 'digitick',
      metadata: {
        importDate: new Date(),
        version: 1
      },
      amount
    })
  )
}

function parseToDate(date, format) {
  return moment(date, format).toDate()
}

function getAmount(amount) {
  return parseFloat(/\d+/g.exec(amount).pop())
}
