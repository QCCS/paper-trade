import Config from '../config'
import Iconv from 'iconv-lite'
import Sequelize from 'sequelize'
import amqp from 'amqplib'
import Rx from 'rxjs'
var sequelize = Config.CreateSequelize();

const homePageSqls = [
    //"SELECT *,0 Type FROM (SELECT `Code`,id Id,Title,SelectPicture Pic,SecuritiesNo,ShowTime FROM wf_news news WHERE  IsStartNews = 0 AND type = 9 AND ColumnNo = '' UNION SELECT `Code`,id,Title,SelectPicture,SecuritiesNo,ShowTime FROM wf_news news,wf_news_column ncolumn WHERE news.ColumnNo = ncolumn.ColumnNo AND (ncolumn.State = 0 OR ncolumn.Type = 0) AND news.Type=9) tp ORDER BY ShowTime desc",
    "select 0 Type,id Id,`Code`,Title,SelectPicture Pic,SecuritiesNo,ShowTime from wf_news news where  IsStartNews = 0 and type = 9 ORDER BY ShowTime desc", //普通资讯
    "SELECT a.ColumnId Id,a.ColumnNo,a.`Name` ColumnTitle,a.HomePage_Image,a.Description ColumnDes,b.`Code`,b.id Id,b.Title,b.SelectPicture Pic FROM wf_news_column a,wf_news b WHERE a.ColumnNo = b.ColumnNo AND a.State = 1 AND a.Type = 1 AND b.Type=9 ORDER BY b.ShowTime desc", //专栏
    "SELECT 2 Type,`Code`,id Id,Thumbnail Pic,Details,CreateTime FROM wf_imagetext WHERE State = 1 AND `Status` = 1 ORDER BY id DESC", //图说
    "SELECT 3 Type,Cover_Image Pic,`Code`,id Id FROM wf_dissertation_type WHERE State = 1 AND `Status` = 1 ORDER BY id DESC", //专题
    "SELECT 4 Type,`Code`,id Id,HomePage_Image Pic FROM wf_books WHERE `Status` = 1 ORDER BY id DESC", //书籍
    "select 5 Type,VoteId Id,VoteCode `Code`,Title,Description Des,HomePageImage Pic,CreateTime,VoteCount from wf_vote where IsDelete = 0 order by CreateTime desc" //投票
];

(async() => {
    var amqpConnection = await amqp.connect(Config.amqpConn)
    let channel = await amqpConnection.createChannel()
    let ok = await channel.assertQueue('homepageGenerate')
    console.log(ok)
    channel.consume('homepageGenerate', msg => {
        //var data = JSON.parse(Iconv.decode(msg.content, 'utf-8'))
        GenerateHomePage()
        channel.ack(msg)
    })
})();

/**
 * 专栏生成器
 * @constructor
 * @param {Object} allColumns - 所有专栏 */
class ColumnGenerator {
    constructor(allColumns) {
        this.currentIndex = 0
        this.allColumns = allColumns
        this.empty = false
    }
    get currentColumn() {
        return this.allColumns[this.currentIndex]
    };
    /**下一轮 */
    gotoNext() {
        if (this.allColumns.length) {
            //if (!this.currentColumn.News.length) {
            if (this.currentColumn.News.length < 4) {
                this.allColumns.splice(this.currentIndex, 1)
                if (!this.allColumns.length) {
                    this.empty = true
                    return
                }
            } else {
                this.currentIndex++;
            }
            //循环获取
            if (this.currentIndex >= this.allColumns.length) {
                this.currentIndex = 0
            }
        } else this.empty = true
    };
    /**获取一个专栏 */
    getOne() {
        if (this.empty) return null
        let l = this.currentColumn.News.length
        let c = l >= 4 ? 4 : l
        if (c == 4) {
            var result = {}
            Object.assign(result, this.currentColumn)
            result.News = this.currentColumn.News.slice(0, c)
            this.currentColumn.News.splice(0, c)
            this.gotoNext()
            return result
        }
        this.gotoNext()
        return this.getOne()
    }
}
/**普通资讯生成器 */
class NewsGenerator {
    constructor(news) {
        this.news = news
        console.log("total news:", news.length)
        this.newsPos = 0
        this.empty = false
    }
    getOne() {
        if (this.empty) return null
        let randNo = getRandomNumber()

        if (this.news.length < this.newsPos + randNo) {
            randNo = this.news.length - this.newsPos
            this.empty = true
            if (!randNo) return null
        }
        //let result = { Type: 0, News: this.news.slice(this.newsPos, this.newsPos + randNo) }
        let result = this.news.slice(this.newsPos, this.newsPos + randNo)
        this.newsPos += randNo
        console.log("剩余：", this.news.length - this.newsPos)
        return result
    }
}
/**随机数生成，3~5 */
function getRandomNumber() {
    return Math.round(Math.random() * 2 + 3)
}
/**首页生成主程序 */
async function GenerateHomePage() {
    //获取最大版本号
    let version = (await sequelize.query("select max(Versions)+1 from wf_homepage"))[0]
    version = version[0]['max(Versions)+1']
    if (!version) version = 1
    let allData = []
    for (let i = 0; i < 6; i++) {
        allData[i] = (await sequelize.query(homePageSqls[i]))[0]
    }
    let columnsMap = {} //按专栏id分组专栏数据
    let columns = []
    for (var data1 of allData[1]) {
        if (!columnsMap[data1.ColumnNo]) {
            columnsMap[data1.ColumnNo] = { Type: 1, Id: data1.ColumnNo, Pic: data1.HomePage_Image, Title: data1.ColumnTitle, Des: data1.ColumnDes, News: [] }
            columns.push(columnsMap[data1.ColumnNo])
        }
        columnsMap[data1.ColumnNo].News.push({ Id: data1.Id, Code: data1.Code, Title: data1.Title, Pic: data1.Pic })
    }
    columnsMap = new ColumnGenerator(columns)
    columns = []
        //把专栏全部生成好
    while (true) {
        let column = columnsMap.getOne()
        if (column) columns.push(column)
        else break
    }
    let newsG = new NewsGenerator(allData[0])
    let pageData = []
    let page = 0
    let news = newsG.getOne()
    pageData.push(...news) //首页先生成几个资讯
    let temp = [columns, allData[2], allData[3], allData[4], allData[5]] //专栏、图说、专题、书籍、投票
    let now = new Date()
    news = null
    while (true) {
        for (let t of temp) {
            if (t.length) {
                pageData.push(t[0])
                t.push(t.shift()) //循环
                news = newsG.getOne()
                if (news) pageData.push(...news)
                else break
            }
        }
        if (!news) break //资讯用完则跳出循环
            //生成的json进行一些格式处理
        let content = JSON.stringify(pageData, (key, value) => {
            switch (key) {
                case "ShowTime":
                case "CreateTime": //时间格式
                    return new Date(value).format()
                case "Pic": //加入图片的路径前缀
                    return Config.picBaseURL + value
                case "Details": //截取前100个字符
                    return value.length > 100 ? value.substr(0, 100) : value
                default:
                    return value
            }
        })
        content = content.substr(1, content.length - 2).replace(/\\r\\n/g, "") //去掉回车换行和前后中括号
        await sequelize.query(`insert into wf_homepage(Versions,Page,Content,CreateTime) values(${version},${page},'${content}','${now.format()}')`)
        pageData.length = 0
        page++
    }
    console.log("生成首页完成,共" + page + "页");
    version = (await sequelize.query("select max(Versions) from wf_homepage where CreateTime < CURDATE()"))[0] //选出今天之前的最大版本号
    version = version[0]['max(Versions)']
    let delResult = await sequelize.query("delete from wf_homepage where Versions < " + version)
    console.log("已删除旧数据：", delResult[0].affectedRows)
}
GenerateHomePage()