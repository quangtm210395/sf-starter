import path from 'path';
import { createServer, Server } from 'http';

import { useExpressServer, useContainer } from 'routing-controllers';
import winston from 'winston';
import express, { Express } from 'express';
import helmet from 'helmet';
import { Container, Inject, Service } from 'typedi';
import { mongoose } from '@typegoose/typegoose';

import { Logger } from '@Decorators/Logger';

import ServiceProvider from '@Libs/provider/ServiceProvider';
import { appEvent } from '@Libs/appEvent';
import { env } from '@Libs/env';
import { ServerType } from '@Libs/env/ServerType';
import { swaggerSetup } from '@Libs/swagger';

import { RestRoles } from '@Enums/RestRoles';

@Service()
export default class HttpProvider extends ServiceProvider {
  private expressApp: Express;
  private httpServer: Server;

  constructor(@Inject('rootPath') private readonly rootPath: string, @Logger(module) private logger: winston.Logger) {
    super();
  }

  async register(): Promise<void> {
    this.expressApp = express();
    this.httpServer = createServer(this.expressApp);
    Container.set('express', this.expressApp);
    Container.set('httpServer', this.httpServer);
    useContainer(Container);
  }

  async boot(): Promise<void> {
    this.expressApp.get('/', (req, res) => {
      return res.send('Hello there');
    });
    this.expressApp.get('/health', (req, res) => {
      return res.send('Healthy');
    });
    this.expressApp.use(helmet());
    useExpressServer(this.expressApp, {
      cors: true,
      classTransformer: true,
      classToPlainTransformOptions: {
        excludePrefixes: ['_'],
        // excludeExtraneousValues: true,
      },
      validation: {
        skipMissingProperties: false,
      },
      routePrefix: env.app.routePrefix || '/api',
      defaultErrorHandler: false,
      controllers: [path.join(this.rootPath, 'controllers/rest/*Controller.{ts,js}')],
      middlewares: [path.join(this.rootPath, 'middlewares/rest/*')],
      interceptors: [path.join(this.rootPath, 'interceptors/rest/*')],
      authorizationChecker: async (action, roles: RestRoles[]) => {
        if (!(action.request as any).identity) {
          return false;
        }
        if (roles && roles.length) {
          const r: string[] = (action.request as any).roles || [];
          if (!roles.find(role => r.indexOf(role.toString()) !== -1)) {
            return false;
          }
        }
        return true;
      },
    });
    swaggerSetup(this.expressApp);
    if (ServerType.allowProducerServer()) {
      //start server http
      this.httpServer.listen(env.app.port, () => {
        appEvent.emit('server_started', env.app.port);
      });
    }
  }

  async close() {
    this.logger.info('Closing http server.');
    return new Promise((resolve, reject) => {
      this.httpServer.close(() => {
        this.logger.info('Http server closed.');
        mongoose.connection.close(false, () => {
          this.logger.info('MongoDb connection closed.');
          resolve(null);
        });
      });
    });
  }
}
